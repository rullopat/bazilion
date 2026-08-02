// Bazilion → pi-coding-agent session bridge.
//
// `createBazilionSession` returns a fully-wired `AgentSession` suitable for
// calling `session.prompt(text)` / `session.compact(instructions)` / etc.
//
// What we take ownership of (and hand to pi):
//   - cwd: the agent's team workspace path. With shell security off, Pi's
//     built-in coding tools use it as their working directory. With Docker
//     isolation on, Bazilion exposes only a same-name containerized `bash`
//     replacement and hides every host-backed coding file tool.
//   - agentDir: `<bazilion-home>/pi` — pi writes transient state here
//     (settings overrides, resource caches). We don't share it with the
//     user's global `~/.pi/agent` so a Bazilion install never clobbers an
//     independent pi CLI install.
//   - authStorage: `InMemoryAuthStorageBackend` pre-seeded with the resolved
//     API key for the agent's current provider. We never let pi read/write
//     its own auth file — secrets live in the daemon-owned `secrets` table
//     and reach us via `opts.apiKey` (initial) + `opts.refreshApiKey`
//     (OAuth refresher for long turns).
//   - modelRegistry: in-memory. Native providers (anthropic/openai/google/…)
//     come from pi's bundled catalog. For Bazilion-only providers
//     (`lmstudio`, `ollama`) we call `registerProvider(name, {baseUrl,
//     api: 'openai-completions', authHeader: false})` — matches the
//     openai-completions shim our pi-adapter has been using.
//   - sessionManager: `SessionManager.create(cwd, <agentDir>/sessions)`
//     writing JSONL to `~/.bazilion/agents/<id>/sessions/<sessionId>.jsonl`.
//     Crash-survival, append-only, branching, compaction entries — all owned
//     by pi now. Replaces our `agents.chat_messages` blob.
//   - settingsManager: in-memory. Bazilion controls auto-compaction
//     (disabled — we compact manually on user request via /compact) and
//     retry (enabled with Bazilion-tuned caps).
//
// What stays outside pi's purview:
//   - spawning agents / profiles / skills discovery (core/)
//   - workspaces registry & mount tracking (core/)
//   - inter-agent messaging, triggers, scheduler (core + apps/web)
//   - memory backend (we wrap it as a pi customTool via `createBazilionCustomTools`)

import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ResolvedAgent } from '@bazilion/api-types'
import type { AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core'
import {
  type AgentSession,
  AuthStorage,
  createAgentSession,
  createExtensionRuntime,
  ModelRegistry,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import type { BazilionDb, Paths } from '../../core/index.ts'
import { providerStateRepo } from '../../core/index.ts'
import type { MemoryBackend } from '../memory/types.ts'
import { resolveModel as resolvePiModel } from '../providers/pi-adapter.ts'
import { createProviderRegistry, loadProviderConfigFromEnv } from '../providers/registry.ts'
import { buildSystemPrompt, loadPromptSkills } from '../session/prompt.ts'
import type { BashApprovalHost } from '../shell/approval.ts'
import { createSessionShellTools } from '../shell/tooling.ts'
import type {
  BrowserHost,
  InjectedMcpTool,
  McpHost,
  MessagingHost,
  UserMdHost,
} from '../worker/ipc-protocol.ts'
import { createBazilionCustomTools } from './tools.ts'

export interface CreateBazilionSessionOptions {
  agent: ResolvedAgent
  paths: Paths
  /** Merged env (process.env + secrets) — produced via `mergeSecretsIntoEnv`. */
  env: NodeJS.ProcessEnv
  memory: MemoryBackend
  /**
   * Names of providers the user has explicitly enabled in /config.
   * Empty set means "no per-provider gating configured" — all providers pass.
   * Pre-computed by the daemon and handed in so the session never has to
   * touch the SQLite `provider_state` table itself.
   */
  enabledProviders: Set<string>
  /**
   * Optional host for inter-agent messaging. Wired from the worker's IPC
   * channel back to the daemon — workers no longer hold a SQLite handle of
   * their own. Omit to disable the messaging tools entirely (e.g. unit
   * tests that don't exercise inbox flows).
   */
  messagingHost?: MessagingHost
  /**
   * Optional host for the team-shared USER.md append tool. Like
   * `messagingHost`, this is wired via the worker's IPC channel. Omit to
   * disable the `user_md_append` tool.
   */
  userMdHost?: UserMdHost
  /**
   * Optional browser pool surface for the `browser_*` tools. Wired from the
   * worker's IPC channel back to the daemon (the Playwright session lives in
   * the daemon, persistent across turns). Omit to disable browser automation.
   */
  browserHost?: BrowserHost
  /**
   * Optional MCP connection-pool surface for proxied MCP tools, paired with
   * `mcpTools`. Wired via the worker's IPC channel. Omit when no MCP servers
   * are enabled.
   */
  mcpHost?: McpHost
  /** MCP tools discovered daemon-side, exposed as proxy tools alongside `mcpHost`. */
  mcpTools?: InjectedMcpTool[]
  /** If provided, enables the `deliver_file` tool — the agent's outbound file channel. */
  fileSink?: import('../tools/deliver-file.ts').FileSink
  /** Turn-scoped bridge for dangerous bash commands. Omit to fail closed. */
  bashApprovalHost?: BashApprovalHost
  /**
   * Optional explicit API key for the agent's provider. Wins over any value
   * derived from `env`. Required for OAuth-backed providers (`openai-codex`)
   * since their credentials live in the daemon-owned `secrets` table, not
   * in env vars.
   */
  apiKey?: string
  /**
   * Optional callback for OAuth-backed providers whose access tokens may
   * expire mid-turn. When provided, pi calls it to refresh the JWT during
   * long tool-execution loops. Daemon-side callers (compact/context/truncate)
   * wire this directly against the secrets repo; worker turns currently
   * skip it (the initial token from `apiKey` carries the whole turn).
   */
  refreshApiKey?: (providerName: string) => Promise<string>
  /**
   * Session id to resume. When omitted, pi starts a fresh session file.
   * `/reset` passes `undefined` to rotate; normal chat passes the agent's
   * current session id (persisted on the Bazilion side as `agents.session_id`
   * if we later add that column — today we just restore the most recent
   * session file, which pi's SessionManager locates automatically).
   */
  sessionId?: string
}

export interface BazilionSessionHandle {
  session: AgentSession
  /** Call when done — disposes listeners + closes the pi session. */
  dispose(): void
}

/**
 * Build a pi `AgentSession` using Bazilion's resolved agent + provider state.
 * The returned session is ready for `prompt()` / `compact()` / `reset()`.
 */
export async function createBazilionSession(
  opts: CreateBazilionSessionOptions,
): Promise<BazilionSessionHandle> {
  const {
    agent,
    paths,
    env,
    memory,
    enabledProviders,
    messagingHost,
    userMdHost,
    browserHost,
    mcpHost,
    mcpTools,
    fileSink,
    bashApprovalHost,
    refreshApiKey,
  } = opts

  const { providerName, modelId } = splitModelString(agent.model)

  // Enabled-set gate — mirrors createProviderRegistry's check. We keep the
  // Bazilion-side enabled/disabled /config toggles authoritative even though
  // pi does its own provider resolution: we simply refuse to build a session
  // for a disabled provider. The set is pre-computed by the daemon (the
  // worker has no SQLite handle of its own).
  if (enabledProviders.size > 0 && !enabledProviders.has(providerName)) {
    throw new Error(`${providerName} provider is disabled — enable it on the /config page`)
  }

  // Build the pi Model<Api>. This reuses the same catalog-lookup + literal-
  // fallback that the pi-adapter uses for Provider.chat today, so `lmstudio:
  // any-model` / unreleased OpenAI models / etc. keep working.
  const piProviderName = mapProviderName(providerName)
  const model = resolvePiModel(
    {
      providerName,
      piProviderName,
      fallbackApi: pickFallbackApi(providerName),
      baseUrl: resolveBaseUrl(providerName, env),
    },
    modelId,
  )

  // Resolve the API key. Caller-supplied `opts.apiKey` wins (the daemon
  // passes pre-fetched OAuth tokens for `openai-codex` here); otherwise
  // fall back to the env-derived key. Pi's AuthStorage is in-memory only —
  // we never write `auth.json`. `setRuntimeApiKey` is the process-scoped
  // override hook AuthStorage exposes for exactly this.
  const apiKey = opts.apiKey ?? resolveApiKey(providerName, env)

  const authStorage = AuthStorage.inMemory()
  if (apiKey) {
    authStorage.setRuntimeApiKey(piProviderName, apiKey)
  }

  const modelRegistry = ModelRegistry.inMemory(authStorage)
  // Bazilion-only providers aren't in pi's bundled catalog; register them
  // dynamically so ModelRegistry accepts the Model<> object + resolves auth.
  if (providerName === 'lmstudio' || providerName === 'ollama') {
    modelRegistry.registerProvider(piProviderName, {
      baseUrl: model.baseUrl,
      api: 'openai-completions',
      authHeader: false,
      apiKey: apiKey ?? 'dummy',
    })
  }

  // cwd is the agent's team directory. Every agent belongs to exactly one
  // team; the team's filesystem root is where work product lives. In host
  // mode Pi uses this as the coding tools' working directory (not a security
  // boundary). In Docker mode only the containerized bash is exposed and the
  // directory is its sole read/write bind mount. Private identity/soul files
  // live in `agent.dir` and are reached through scoped `home_*` tools.
  const cwd = agent.team.path
  if (!existsSync(cwd)) mkdirSync(cwd, { recursive: true })

  const promptSkills = loadPromptSkills(paths.skillsDir, agent.skills)
  const uploadsDir = join(agent.agent.dir, 'uploads')
  const shellTools = createSessionShellTools(cwd, env, {
    ...(existsSync(uploadsDir) ? { inputsDir: uploadsDir } : {}),
    skillMounts: promptSkills.map((skill) => ({
      source: skill.hostDir,
      target: skill.sandboxDir,
    })),
    approvalHost: bashApprovalHost,
  })

  // Session file under the agent's own directory. Keeping it under
  // `agents/<id>/sessions/` makes `bazilion uninstall` (data tier) already
  // clean them up without changes.
  //
  // Resume-or-create: pi's SessionManager has no built-in "latest session"
  // opener. We walk the session dir for the newest `.jsonl` and open it;
  // fall back to `create()` when none exists (fresh agent or post-/reset).
  // This is what makes turn-to-turn continuity work: each worker turn picks
  // up where the last one left off.
  const sessionDir = join(paths.agentDir(agent.agent.id), 'sessions')
  mkdirSync(sessionDir, { recursive: true })
  const existing = findMostRecent(sessionDir)
  const sessionManager = existing
    ? SessionManager.open(existing, sessionDir, cwd)
    : SessionManager.create(cwd, sessionDir)

  // In-memory settings: auto-compaction off (we trigger compaction manually
  // via /compact), retry on with Bazilion-tuned caps matching what withRetry
  // used to apply before pi-adoption.
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: {
      enabled: true,
      maxRetries: 2,
      baseDelayMs: 500,
      provider: { maxRetryDelayMs: 8_000 },
    },
  })

  // Bazilion-authored system prompt becomes an `appendSystemPrompt` entry.
  // Pi keeps its default base (which lists built-in tools + guidelines), our
  // profile content (SOUL.md / IDENTITY.md / workspaces / memory hint) is
  // concatenated after it. This is the same injection hook pi extensions use.
  const bazilionPrompt = buildSystemPrompt(agent, {
    skills: promptSkills,
    sandboxMode: shellTools.config.sandboxMode,
  })
  const resourceLoader = createBazilionResourceLoader(bazilionPrompt)
  await resourceLoader.reload()

  // Tool allowlist: pi's `tools` option is exclusive when provided — only
  // the listed names are enabled, regardless of what's in `customTools`.
  // So we enumerate the host-backed Pi tools allowed by the shell policy and
  // every Bazilion custom tool we want the LLM to see. Docker mode contributes
  // a custom same-name `bash` and zero host tools; missing its name (or any
  // memory/messaging/web/bootstrap name) would silently drop it.
  const bazilionTools = createBazilionCustomTools({
    agent,
    memory,
    messagingHost,
    userMdHost,
    browserHost,
    mcpHost,
    mcpTools,
    fileSink,
    env,
  })
  const customTools = shellTools.customBash
    ? [...bazilionTools, shellTools.customBash]
    : bazilionTools
  const allowedTools = [...shellTools.hostToolNames, ...customTools.map((t) => t.name)]

  const { session } = await createAgentSession({
    cwd,
    agentDir: join(paths.home, 'pi'),
    model,
    thinkingLevel: toPiThinkingLevel(agent.reasoningLevel),
    tools: allowedTools,
    customTools,
    sessionManager,
    settingsManager,
    authStorage,
    modelRegistry,
    resourceLoader,
  })

  // OAuth providers: wire pi's per-request `getApiKey` callback so the JWT
  // gets refreshed *during* a long tool-execution loop, not just at the
  // start of the turn. This is exactly the use case pi-agent-core's doc
  // calls out for this hook ("short-lived OAuth tokens that may expire
  // during long-running tool execution phases"). Caller supplies the
  // refresher because only they have access to the secrets table.
  if (refreshApiKey) {
    session.agent.getApiKey = async (requestedProvider) => {
      if (requestedProvider !== piProviderName) return undefined
      try {
        return await refreshApiKey(providerName)
      } catch {
        // Stale/removed credentials mid-session → return undefined so pi
        // surfaces a "no auth" error cleanly instead of us throwing out of
        // the provider callback (which would drag down the whole turn).
        return undefined
      }
    }
  }

  return {
    session,
    dispose() {
      session.dispose()
    },
  }
}

// --- helpers ---

function splitModelString(s: string): { providerName: string; modelId: string } {
  const idx = s.indexOf(':')
  if (idx === -1) {
    throw new Error(`invalid model string "${s}": expected "provider:model"`)
  }
  return { providerName: s.slice(0, idx), modelId: s.slice(idx + 1) }
}

/**
 * Map Bazilion provider names to pi's canonical `piProviderName` for catalog
 * lookups. The split exists because Bazilion was registering e.g. `bedrock`
 * but pi catalogs it as `amazon-bedrock`.
 */
function mapProviderName(name: string): string {
  if (name === 'bedrock') return 'amazon-bedrock'
  return name
}

function pickFallbackApi(providerName: string): string {
  switch (providerName) {
    case 'anthropic':
      return 'anthropic-messages'
    case 'google':
      return 'google-generative-ai'
    case 'google-vertex':
      return 'google-vertex'
    case 'azure-openai':
      return 'azure-openai-responses'
    case 'bedrock':
      return 'bedrock-converse-stream'
    case 'openai-codex':
      return 'openai-codex-responses'
    default:
      return 'openai-completions'
  }
}

function resolveBaseUrl(providerName: string, env: NodeJS.ProcessEnv): string | undefined {
  if (providerName === 'lmstudio') return env.LMSTUDIO_URL ?? 'http://127.0.0.1:1234/v1'
  if (providerName === 'ollama') return env.OLLAMA_URL ?? 'http://127.0.0.1:11434/v1'
  return undefined
}

function resolveApiKey(providerName: string, env: NodeJS.ProcessEnv): string | undefined {
  // Hand-written table mirroring loadProviderConfigFromEnv — cheaper than
  // spinning up a whole ProviderRegistry just to pluck one field.
  switch (providerName) {
    case 'anthropic':
      return env.ANTHROPIC_OAUTH_TOKEN ?? env.ANTHROPIC_API_KEY
    case 'openai':
      return env.OPENAI_API_KEY
    case 'google':
      return env.GEMINI_API_KEY
    case 'mistral':
      return env.MISTRAL_API_KEY
    case 'groq':
      return env.GROQ_API_KEY
    case 'cerebras':
      return env.CEREBRAS_API_KEY
    case 'xai':
      return env.XAI_API_KEY
    case 'zai':
      return env.ZAI_API_KEY
    case 'huggingface':
      return env.HF_TOKEN
    case 'openrouter':
      return env.OPENROUTER_API_KEY
    case 'vercel-ai-gateway':
      return env.AI_GATEWAY_API_KEY
    case 'azure-openai':
      return env.AZURE_OPENAI_API_KEY
    case 'lmstudio':
      return env.LMSTUDIO_API_KEY ?? 'lm-studio'
    case 'ollama':
      return env.OLLAMA_API_KEY ?? 'ollama'
    default:
      return undefined
  }
}

function toPiThinkingLevel(level: string): ThinkingLevel {
  switch (level) {
    case 'off':
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return level
    default:
      return 'medium'
  }
}

/**
 * Minimal `ResourceLoader` implementation — feeds pi our Bazilion-authored
 * system prompt block via `getAppendSystemPrompt` and returns empty collections
 * for everything else. Pi's default loader reads skill/prompt/theme markdown
 * from the workspace cwd; we intentionally opt out because Bazilion owns skill
 * discovery at the platform level (see `apps/daemon/src/core/skills`).
 */
function createBazilionResourceLoader(appendSystemPrompt: string): ResourceLoader {
  const extensions = { extensions: [], errors: [], runtime: createExtensionRuntime() }
  return {
    getExtensions: () => extensions,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => undefined,
    getAppendSystemPrompt: () => (appendSystemPrompt ? [appendSystemPrompt] : []),
    extendResources: () => {},
    async reload() {},
  }
}

/**
 * Re-exported for callers that want to check whether a provider is
 * Bazilion-enabled before even trying to spawn a session (e.g. /context
 * endpoint which builds a session just to enumerate tools).
 */
export function isProviderEnabled(db: BazilionDb, providerName: string): boolean {
  const enabled = providerStateRepo.listEnabled(db)
  return enabled.size === 0 || enabled.has(providerName)
}

/**
 * Escape hatch for callers that need the raw provider registry (e.g. the
 * current /api/providers/test endpoint). Keeps that one endpoint on our
 * existing non-pi path until we migrate it in a follow-up.
 */
export function loadEnabledRegistry(db: BazilionDb, authToken: string, env: NodeJS.ProcessEnv) {
  return createProviderRegistry(loadProviderConfigFromEnv(env, { db, authToken }), {
    enabledSet: providerStateRepo.listEnabled(db),
  })
}

/**
 * Read the most recent session file for an agent *without* spawning a full
 * AgentSession, and return the resolved provider-message view. Used for SSR
 * page loads that only need to render the canonical transcript — no need
 * to boot pi just to inspect the transcript.
 *
 * Returns an empty array when the agent has no prior session (fresh spawn,
 * or post-/reset).
 */
export function loadInitialMessages(agent: ResolvedAgent, paths: Paths): AgentMessage[] {
  const sessionDir = join(paths.agentDir(agent.agent.id), 'sessions')
  if (!existsSync(sessionDir)) return []
  const cwd = agent.team.path
  if (!existsSync(cwd)) return []
  const recent = findMostRecent(sessionDir)
  if (!recent) return []
  try {
    const sm = SessionManager.open(recent, sessionDir)
    const ctx = sm.buildSessionContext()
    return ctx.messages
  } catch (err) {
    // Corrupt session file, stale format, or pi version bump — log loud
    // enough that an operator noticing a blank chat can find the cause in
    // server logs. The turn loop itself starts a fresh session on the
    // next message, so this isn't load-bearing for writes, only reads.
    console.error(
      `[session] loadInitialMessages failed for agent ${agent.agent.id} (${recent}):`,
      err instanceof Error ? (err.stack ?? err.message) : err,
    )
    return []
  }
}

/**
 * Cheap "has the session changed?" probe for polling clients (the web chat
 * stale-tab banner). Returns the most recent session file's basename plus
 * byte size — append-only JSONL, so either value moving means new activity.
 * Returns `{ file: null, size: 0 }` for agents that have never had a turn.
 */
export function loadSessionHead(
  agent: ResolvedAgent,
  paths: Paths,
): { file: string | null; size: number } {
  const sessionDir = join(paths.agentDir(agent.agent.id), 'sessions')
  if (!existsSync(sessionDir)) return { file: null, size: 0 }
  const recent = findMostRecent(sessionDir)
  if (!recent) return { file: null, size: 0 }
  try {
    const s = statSync(recent)
    return { file: basename(recent), size: s.size }
  } catch {
    return { file: null, size: 0 }
  }
}

/**
 * Test helper: seed a pi session file for an agent with `n` synthetic
 * user/assistant message pairs. Writes a real JSONL entry tree via
 * SessionManager so round-tripping through pi's own reader stays honest.
 * Exported from runtime rather than lived in tests because tests in apps/cli
 * can't directly import pi packages (not a direct dep).
 */
export function seedSessionForTest(
  agent: ResolvedAgent,
  paths: Paths,
  messages: Array<{ role: 'user' | 'assistant'; text: string }>,
): void {
  const cwd = agent.team.path
  if (!existsSync(cwd)) mkdirSync(cwd, { recursive: true })
  const sessionDir = join(paths.agentDir(agent.agent.id), 'sessions')
  mkdirSync(sessionDir, { recursive: true })
  const sm = SessionManager.create(cwd, sessionDir)
  const now = Date.now()
  messages.forEach((m, i) => {
    if (m.role === 'user') {
      sm.appendMessage({
        role: 'user',
        content: [{ type: 'text', text: m.text }],
        timestamp: now + i,
      })
    } else {
      sm.appendMessage({
        role: 'assistant',
        content: [{ type: 'text', text: m.text }],
        api: 'openai-completions',
        provider: 'lmstudio',
        model: 'test-model',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: now + i,
      })
    }
  })
}

/**
 * Test helper: count message entries on the current leaf's branch of the
 * agent's most-recent session file. Returns 0 when no session file exists.
 */
export function countSessionMessagesForTest(agent: ResolvedAgent, paths: Paths): number {
  const sessionDir = join(paths.agentDir(agent.agent.id), 'sessions')
  const recent = findMostRecent(sessionDir)
  if (!recent) return 0
  const cwd = agent.team.path
  try {
    const sm = SessionManager.open(recent, sessionDir, cwd)
    return sm.getBranch().filter((e) => e.type === 'message').length
  } catch {
    return 0
  }
}

/** Newest `.jsonl` in a pi session directory by mtime, or null if empty. */
function findMostRecent(sessionDir: string): string | null {
  if (!existsSync(sessionDir)) return null
  let newest: { path: string; mtimeMs: number } | null = null
  for (const entry of readdirSync(sessionDir)) {
    if (!entry.endsWith('.jsonl')) continue
    const path = join(sessionDir, entry)
    try {
      const s = statSync(path)
      if (!newest || s.mtimeMs > newest.mtimeMs) newest = { path, mtimeMs: s.mtimeMs }
    } catch {
      // ignore races
    }
  }
  return newest?.path ?? null
}
