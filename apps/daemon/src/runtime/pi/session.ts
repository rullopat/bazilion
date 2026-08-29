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

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ResolvedAgent } from '@bazilion/api-types'
import type { AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core'
import {
  type AssistantMessage,
  type AssistantMessageEvent,
  createAssistantMessageEventStream,
} from '@earendil-works/pi-ai'
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import type { BazilionDb, Paths } from '../../core/index.ts'
import { providerStateRepo } from '../../core/index.ts'
import type { MemoryBackend } from '../memory/types.ts'
import {
  createBazilionPiRuntime,
  createProtectedPiRuntime,
  piProviderName,
  providerApiKey,
  providerBaseUrl,
  resolvePiModel,
} from '../providers/pi-runtime.ts'
import { createProviderRegistry, loadProviderConfigFromEnv } from '../providers/registry.ts'
import { buildSystemPrompt, loadPromptSkills } from '../session/prompt.ts'
import type { BashApprovalHost } from '../shell/approval.ts'
import type { ProtectedDockerRuntime } from '../shell/docker.ts'
import { createProtectedSessionShellTools, createSessionShellTools } from '../shell/tooling.ts'
import type {
  BrowserHost,
  InjectedMcpTool,
  McpHost,
  MessagingHost,
  UserMdHost,
} from '../worker/ipc-protocol.ts'
import type {
  MinimalWorkerScratch,
  ProtectedProviderWorkerRuntime,
  ProtectedWorkerPaths,
} from '../worker/runtime.ts'
import { protectedRuntimeSecrets, redactJsonValue } from '../worker/runtime.ts'
import { createBazilionCustomTools, createProtectedBazilionCustomTools } from './tools.ts'

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
   * wire this directly against the secrets repo; worker turns call the same
   * daemon-owned refresher through their private, turn-scoped IPC channel.
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
  /** Internal restricted mode used by the learning reviewer. */
  restricted?: {
    systemPrompt: string
    tools: ToolDefinition[]
    sessionDir: string
    reasoningLevel: ResolvedAgent['reasoningLevel']
  }
}

export interface BazilionSessionHandle {
  session: AgentSession
  /** Call when done — disposes listeners + closes the pi session. */
  dispose(): void
}

export interface CreateProtectedBazilionSessionOptions {
  agent: ResolvedAgent
  runtime: ProtectedProviderWorkerRuntime
  paths: ProtectedWorkerPaths
  scratch: MinimalWorkerScratch
  docker: ProtectedDockerRuntime
  memory: MemoryBackend
  messagingHost: MessagingHost
  userMdHost: UserMdHost
  fileSink: import('../tools/deliver-file.ts').FileSink
  bashApprovalHost: BashApprovalHost
  refreshApiKey: (providerName: string) => Promise<string>
}

export interface CreateRestrictedReviewSessionOptions {
  runtime: ProtectedProviderWorkerRuntime
  scratch: MinimalWorkerScratch
  systemPrompt: string
  tools: ToolDefinition[]
  refreshApiKey: (providerName: string) => Promise<string>
}

const PROTECTED_MODEL_CWD = '/workspace'
const REVIEW_MODEL_CWD = '/review'
const PROTECTED_BASE_SYSTEM_PROMPT = `You are an assistant operating inside Bazilion's protected
Agent runtime. Use only the tools exposed for this turn. Coding commands execute in an ephemeral,
network-disabled Docker container whose Team workspace is /workspace. Host paths and host tools are
not available. Be concise and show container paths clearly when working with files.`

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
    restricted,
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

  // One public Pi runtime owns provider aliases, credentials, catalog lookup,
  // local-provider registration and arbitrary-model fallback for both direct
  // Provider.chat calls and full coding-agent sessions.
  const apiKey = opts.apiKey ?? providerApiKey(providerName, env)
  const baseUrl = providerBaseUrl(providerName, env)
  const modelRuntime = await createBazilionPiRuntime({
    providerName,
    env,
    ...(apiKey ? { apiKey } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    modelId,
  })
  const model = resolvePiModel(modelRuntime, providerName, modelId, baseUrl)

  // cwd is the agent's team directory. Every agent belongs to exactly one
  // team; the team's filesystem root is where work product lives. In host
  // mode Pi uses this as the coding tools' working directory (not a security
  // boundary). In Docker mode only the containerized bash is exposed and the
  // directory is its sole read/write bind mount. Private identity/soul files
  // live in `agent.dir` and are reached through scoped `home_*` tools.
  const cwd = agent.team.path
  if (!existsSync(cwd)) mkdirSync(cwd, { recursive: true })

  const promptSkills = restricted ? [] : loadPromptSkills(paths.skillsDir, agent.skills)
  const uploadsDir = join(agent.agent.dir, 'uploads')
  const shellTools = restricted
    ? null
    : createSessionShellTools(cwd, env, {
        ...(existsSync(uploadsDir) ? { inputsDir: uploadsDir } : {}),
        skillMounts: promptSkills.map((skill) => ({
          source: skill.hostDir,
          target: skill.sandboxDir,
        })),
        approvalHost: bashApprovalHost,
      })

  // Session file under the agent's own directory. Keeping it under
  // `agents/<id>/sessions/` makes `bazilion uninstall` (reset tier) already
  // clean them up without changes.
  //
  // Resume-or-create: pi's SessionManager has no built-in "latest session"
  // opener. We walk the session dir for the newest `.jsonl` and open it;
  // fall back to `create()` when none exists (fresh agent or post-/reset).
  // This is what makes turn-to-turn continuity work: each worker turn picks
  // up where the last one left off.
  const sessionDir = restricted?.sessionDir ?? join(paths.agentDir(agent.agent.id), 'sessions')
  mkdirSync(sessionDir, { recursive: true })
  const existing = restricted ? null : findMostRecent(sessionDir)
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
  const bazilionPrompt =
    restricted?.systemPrompt ??
    buildSystemPrompt(agent, {
      skills: promptSkills,
      sandboxMode: shellTools?.config.sandboxMode ?? 'off',
    })
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: join(paths.home, 'pi'),
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    appendSystemPrompt: bazilionPrompt ? [bazilionPrompt] : undefined,
  })
  await resourceLoader.reload()

  // Tool allowlist: pi's `tools` option is exclusive when provided — only
  // the listed names are enabled, regardless of what's in `customTools`.
  // So we enumerate the host-backed Pi tools allowed by the shell policy and
  // every Bazilion custom tool we want the LLM to see. Docker mode contributes
  // a custom same-name `bash` and zero host tools; missing its name (or any
  // memory/messaging/web/bootstrap name) would silently drop it.
  const bazilionTools = restricted
    ? restricted.tools
    : createBazilionCustomTools({
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
  const customTools = shellTools?.customBash
    ? [...bazilionTools, shellTools.customBash]
    : bazilionTools
  const allowedTools = [...(shellTools?.hostToolNames ?? []), ...customTools.map((t) => t.name)]

  const { session } = await createAgentSession({
    cwd,
    agentDir: join(paths.home, 'pi'),
    model,
    thinkingLevel: toPiThinkingLevel(restricted?.reasoningLevel ?? agent.reasoningLevel),
    tools: allowedTools,
    customTools,
    sessionManager,
    settingsManager,
    modelRuntime,
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
      if (requestedProvider !== piProviderName(providerName)) return undefined
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

/** Build the closed Docker-only normal session used by protected invocations. */
export async function createProtectedBazilionSession(
  opts: CreateProtectedBazilionSessionOptions,
): Promise<BazilionSessionHandle> {
  const { providerName, modelId } = splitModelString(opts.agent.model)
  if (providerName !== opts.runtime.providerName || modelId !== opts.runtime.modelId) {
    throw new Error('protected Agent model does not match the prepared provider runtime')
  }
  if (opts.agent.agent.dir !== opts.paths.agentDir || opts.agent.team.path !== opts.paths.teamDir) {
    throw new Error('protected session paths do not match the resolved Agent')
  }
  if (!existsSync(opts.paths.teamDir)) {
    throw new Error('protected Team workspace is unavailable')
  }

  const modelRuntime = await createProtectedPiRuntime({
    providerName: opts.runtime.providerName,
    modelId: opts.runtime.modelId,
    apiKey: opts.runtime.apiKey,
    baseUrl: opts.runtime.baseUrl,
    credentialEnv: materializeProtectedCredentialFile(opts.runtime, opts.scratch),
  })
  const model = resolvePiModel(
    modelRuntime,
    opts.runtime.providerName,
    opts.runtime.modelId,
    opts.runtime.baseUrl,
  )
  const shellTools = createProtectedSessionShellTools(
    opts.paths.teamDir,
    opts.docker,
    opts.bashApprovalHost,
  )

  mkdirSync(opts.paths.sessionDir, { recursive: true })
  const existing = findMostRecent(opts.paths.sessionDir)
  const sessionManager = existing
    ? SessionManager.open(existing, opts.paths.sessionDir, opts.paths.teamDir)
    : SessionManager.create(opts.paths.teamDir, opts.paths.sessionDir)
  const settingsManager = createInMemorySettingsManager()
  const bazilionPrompt = redactJsonValue(
    buildSystemPrompt(opts.agent, {
      skills: opts.paths.skills,
      sandboxMode: 'docker',
      homeDocuments: opts.paths.homeDocuments,
    }),
    protectedRuntimeSecrets(opts.runtime),
  )
  const resourceLoader = new DefaultResourceLoader({
    cwd: PROTECTED_MODEL_CWD,
    agentDir: opts.scratch.piAgentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: PROTECTED_BASE_SYSTEM_PROMPT,
    appendSystemPrompt: bazilionPrompt ? [bazilionPrompt] : undefined,
  })
  await resourceLoader.reload()

  const bazilionTools = createProtectedBazilionCustomTools({
    agent: opts.agent,
    memory: opts.memory,
    messagingHost: opts.messagingHost,
    userMdHost: opts.userMdHost,
    fileSink: opts.fileSink,
  })
  if (!shellTools.customBash) throw new Error('protected Docker bash tool is unavailable')
  const customTools = [...bazilionTools, shellTools.customBash]
  const { session } = await createAgentSession({
    cwd: PROTECTED_MODEL_CWD,
    agentDir: opts.scratch.piAgentDir,
    model,
    thinkingLevel: toPiThinkingLevel(opts.runtime.reasoningLevel),
    tools: customTools.map((tool) => tool.name),
    customTools,
    sessionManager,
    settingsManager,
    modelRuntime,
    resourceLoader,
  })
  installProtectedCredentialBoundary(
    session,
    opts.runtime.providerName,
    protectedRuntimeSecrets(opts.runtime),
    opts.refreshApiKey,
  )
  return sessionHandle(session)
}

/** Build a scratch-only reviewer with exactly the caller-supplied proposal tool. */
export async function createRestrictedReviewSession(
  opts: CreateRestrictedReviewSessionOptions,
): Promise<BazilionSessionHandle> {
  const modelRuntime = await createProtectedPiRuntime({
    providerName: opts.runtime.providerName,
    modelId: opts.runtime.modelId,
    apiKey: opts.runtime.apiKey,
    baseUrl: opts.runtime.baseUrl,
    credentialEnv: materializeProtectedCredentialFile(opts.runtime, opts.scratch),
  })
  const model = resolvePiModel(
    modelRuntime,
    opts.runtime.providerName,
    opts.runtime.modelId,
    opts.runtime.baseUrl,
  )
  const settingsManager = createInMemorySettingsManager()
  const sessionManager = SessionManager.create(
    opts.scratch.reviewCwd,
    opts.scratch.reviewSessionDir,
  )
  const resourceLoader = new DefaultResourceLoader({
    cwd: REVIEW_MODEL_CWD,
    agentDir: opts.scratch.piAgentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: opts.systemPrompt,
  })
  await resourceLoader.reload()

  const { session } = await createAgentSession({
    cwd: REVIEW_MODEL_CWD,
    agentDir: opts.scratch.piAgentDir,
    model,
    thinkingLevel: toPiThinkingLevel(opts.runtime.reasoningLevel),
    tools: opts.tools.map((tool) => tool.name),
    customTools: opts.tools,
    sessionManager,
    settingsManager,
    modelRuntime,
    resourceLoader,
  })
  installProtectedCredentialBoundary(
    session,
    opts.runtime.providerName,
    protectedRuntimeSecrets(opts.runtime),
    opts.refreshApiKey,
  )
  return sessionHandle(session)
}

function materializeProtectedCredentialFile(
  runtime: ProtectedProviderWorkerRuntime,
  scratch: MinimalWorkerScratch,
): Array<{ name: string; value: string }> | undefined {
  const fields = [...(runtime.credentialEnv ?? [])]
  if (runtime.credentialFile) {
    const path = join(scratch.tempDir, 'provider-credential.json')
    writeFileSync(path, runtime.credentialFile.content, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    })
    fields.push({ name: runtime.credentialFile.envName, value: path })
  }
  return fields.length > 0 ? fields : undefined
}

// --- helpers ---

function createInMemorySettingsManager(): SettingsManager {
  return SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: {
      enabled: true,
      maxRetries: 2,
      baseDelayMs: 500,
      provider: { maxRetryDelayMs: 8_000 },
    },
  })
}

export function installProtectedCredentialBoundary(
  session: AgentSession,
  providerName: string,
  initialSecrets: string[],
  refreshApiKey: (providerName: string) => Promise<string>,
): void {
  const activeTokens = [...new Set(initialSecrets.filter(Boolean))]
  session.agent.state.messages = redactJsonValue(session.agent.state.messages, activeTokens)
  const originalStream = session.agent.streamFunction
  session.agent.streamFunction = async (model, context, options) => {
    let upstream: Awaited<ReturnType<typeof originalStream>>
    try {
      upstream = await originalStream(model, context, options)
    } catch (error) {
      throw credentialSafeError(error, activeTokens)
    }
    const sanitized = createAssistantMessageEventStream()
    void (async () => {
      let latestPartial: AssistantMessage | undefined
      try {
        for await (const event of upstream) {
          const safeEvent = redactJsonValue(event, activeTokens) as AssistantMessageEvent
          if ('partial' in safeEvent) latestPartial = safeEvent.partial
          sanitized.push(safeEvent)
        }
      } catch (error) {
        const safeError = credentialSafeError(error, activeTokens)
        sanitized.push({
          type: 'error',
          reason: 'error',
          error: credentialSafeAssistantError(model, latestPartial, safeError, activeTokens),
        })
      } finally {
        sanitized.end()
      }
    })()
    return sanitized
  }

  const originalAfterToolCall = session.agent.afterToolCall
  session.agent.afterToolCall = async (context, signal) => {
    let prior: Awaited<ReturnType<NonNullable<typeof originalAfterToolCall>>> | undefined
    try {
      prior = await originalAfterToolCall?.(context, signal)
    } catch (error) {
      throw credentialSafeError(error, activeTokens)
    }
    return {
      ...prior,
      content: redactJsonValue(prior?.content ?? context.result.content, activeTokens),
      details: redactJsonValue(prior?.details ?? context.result.details, activeTokens),
    }
  }

  session.agent.getApiKey = async (requestedProvider) => {
    if (requestedProvider !== providerName) return undefined
    try {
      const token = await refreshApiKey(providerName)
      if (token && !activeTokens.includes(token)) activeTokens.push(token)
      return token || undefined
    } catch {
      return undefined
    }
  }
}

function credentialSafeError(error: unknown, activeTokens: readonly string[]): Error {
  const message = error instanceof Error ? error.message : String(error)
  return new Error(redactJsonValue(message, activeTokens))
}

function credentialSafeAssistantError(
  model: {
    api: AssistantMessage['api']
    provider: AssistantMessage['provider']
    id: string
  },
  latestPartial: AssistantMessage | undefined,
  error: Error,
  activeTokens: readonly string[],
): AssistantMessage {
  const safePartial = latestPartial
    ? redactJsonValue(latestPartial, activeTokens)
    : {
        role: 'assistant' as const,
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        timestamp: Date.now(),
      }
  return {
    ...safePartial,
    stopReason: 'error',
    errorMessage: error.message,
    timestamp: Date.now(),
  }
}

function sessionHandle(session: AgentSession): BazilionSessionHandle {
  return {
    session,
    dispose() {
      session.dispose()
    },
  }
}

function splitModelString(s: string): { providerName: string; modelId: string } {
  const idx = s.indexOf(':')
  if (idx === -1) {
    throw new Error(`invalid model string "${s}": expected "provider:model"`)
  }
  return { providerName: s.slice(0, idx), modelId: s.slice(idx + 1) }
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

/** Read one named canonical session for evidence display without creating a live session. */
export function loadSessionMessages(
  agent: ResolvedAgent,
  paths: Paths,
  sessionId: string,
): AgentMessage[] {
  if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) return []
  const sessionDir = join(paths.agentDir(agent.agent.id), 'sessions')
  const file = join(sessionDir, `${sessionId}.jsonl`)
  if (!existsSync(file) || !existsSync(agent.team.path)) return []
  try {
    return SessionManager.open(file, sessionDir).buildSessionContext().messages
  } catch {
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
