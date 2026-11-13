// Builds Pi `AgentSession`s. Pi owns the agent loop, the JSONL transcript, compaction and provider
// retries; Bazilion supplies the model (credentials in memory only), the appended system prompt,
// the tool list and the explicit conversation file. Nothing is discovered from disk: no Pi
// extensions, skills, prompt templates, themes or context files, so a repository's `.pi/` cannot
// run code. Pi's scratch state lives in `<home>/pi`, apart from any `~/.pi` of the operator.

import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ConversationTarget, ResolvedAgent } from '@bazilion/api-types'
import type { AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core'
import {
  type AgentSession,
  buildSessionContext,
  createAgentSession,
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  DefaultResourceLoader,
  estimateTokens,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import type { Paths } from '../../core/index.ts'
import { parseModelString, piProviderName } from '../../core/providers.ts'
import type { MemoryBackend } from '../memory/types.ts'
import { createPiModel, type PiModelSpec } from '../providers/pi-runtime.ts'
import {
  type BuildSystemPromptOptions,
  buildSystemPrompt,
  buildSystemPromptSections,
  loadPromptSkills,
  type PromptSection,
} from '../session/prompt.ts'
import type { BashApprovalHost } from '../shell/approval.ts'
import { containerWorkdir, homeContainerPrefix } from '../shell/docker.ts'
import { createSessionShellTools, type DockerTurn } from '../shell/tooling.ts'
import type { AskUser } from '../tools/ask-user.ts'
import type { FileSink } from '../tools/deliver-file.ts'
import type {
  BrowserHost,
  ImageGenerationHost,
  InjectedMcpTool,
  McpHost,
  MessagingHost,
  UserMdHost,
  WebSearchHost,
} from '../worker/ipc-protocol.ts'
import type {
  MinimalWorkerScratch,
  RepositoryInstructions,
  ReviewProviderRuntime,
} from '../worker/runtime.ts'
import { envSecretValues, reviewRuntimeSecrets } from '../worker/runtime.ts'
import { readSessionFile, readSessionHeader } from './session-file.ts'
import { createBazilionCustomTools } from './tools.ts'

export interface CreateBazilionSessionOptions {
  agent: ResolvedAgent
  paths: Paths
  /** The explicit conversation file; there is no "latest session" fallback. */
  conversation: ConversationTarget
  /** Merged env (process.env + secrets), from `mergeSecretsIntoEnv`. */
  env: NodeJS.ProcessEnv
  memory: MemoryBackend
  /** The turn's Docker settings when BAZILION_BASH_SANDBOX is docker. */
  docker?: DockerTurn
  /** Workspace AGENTS.md files (Team-relative paths), given to Pi as project instructions. */
  repositoryInstructions?: RepositoryInstructions
  // Optional hosts: each enables its tools; a worker turn reaches them over IPC.
  messagingHost?: MessagingHost
  userMdHost?: UserMdHost
  browserHost?: BrowserHost
  /** MCP tools discovered daemon-side, proxied through `mcpHost`. */
  mcpHost?: McpHost
  mcpTools?: InjectedMcpTool[]
  askUser?: AskUser
  imageGenerationHost?: ImageGenerationHost
  /** Enables `deliver_file`, the agent's outbound file channel. */
  fileSink?: FileSink
  webSearchHost?: WebSearchHost
  /** Turn-scoped bridge for dangerous bash commands. Omit to deny them. */
  bashApprovalHost?: BashApprovalHost
  /** Wins over the key in `env`: the ChatGPT access token (OAuth keys are not env values). */
  apiKey?: string
  /** Refreshes an OAuth access token that expires during a long turn. */
  refreshApiKey?: (providerName: string) => Promise<string>
}

export interface BazilionSessionHandle {
  session: AgentSession
  /**
   * Credential values redacted from tool output before it reaches a client. Mutable: a token
   * refreshed mid-turn joins it before the next output is translated.
   */
  redactionSecrets: readonly string[]
  /** Call when done — disposes listeners + closes the pi session. */
  dispose(): void
}

export interface CreateRestrictedReviewSessionOptions {
  runtime: ReviewProviderRuntime
  scratch: MinimalWorkerScratch
  systemPrompt: string
  tools: ToolDefinition[]
  /** The ChatGPT token refresher; static credentials stay in Pi's in-memory store. */
  refreshApiKey?: (providerName: string) => Promise<string>
}

interface PiSessionSpec {
  model: PiModelSpec
  reasoningLevel: string
  /** The working directory the model is told about. */
  cwd: string
  piAgentDir: string
  sessionManager: SessionManager
  /** Replaces Pi's base prompt; otherwise `appendSystemPrompt` is appended to it. */
  systemPrompt?: string
  appendSystemPrompt?: string
  agentsFiles?: Array<{ path: string; content: string }>
  tools: ToolDefinition[]
  /** Pi's own (host-backed) coding tools to enable alongside `tools`. */
  hostToolNames?: readonly string[]
  redactionSecrets: string[]
  refreshApiKey?: (providerName: string) => Promise<string>
}

async function openPiSession(spec: PiSessionSpec): Promise<BazilionSessionHandle> {
  const { runtime: modelRuntime, model } = await createPiModel(spec.model)
  const settingsManager = SettingsManager.inMemory({
    // Provider requests happen only for turns: no cache warming, and compaction runs only on
    // request (/compact).
    cacheWarming: 'off',
    compaction: { enabled: false },
    retry: {
      enabled: true,
      maxRetries: 2,
      baseDelayMs: 500,
      provider: { maxRetryDelayMs: 8_000 },
    },
  })
  const resourceLoader = new DefaultResourceLoader({
    cwd: spec.cwd,
    agentDir: spec.piAgentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    ...(spec.systemPrompt !== undefined ? { systemPrompt: spec.systemPrompt } : {}),
    ...(spec.appendSystemPrompt ? { appendSystemPrompt: [spec.appendSystemPrompt] } : {}),
    agentsFilesOverride: () => ({ agentsFiles: spec.agentsFiles ?? [] }),
  })
  await resourceLoader.reload()

  // Pi's `tools` list is exclusive: a tool missing from it is disabled even when defined.
  const { session } = await createAgentSession({
    cwd: spec.cwd,
    agentDir: spec.piAgentDir,
    model,
    thinkingLevel: toPiThinkingLevel(spec.reasoningLevel),
    tools: [...(spec.hostToolNames ?? []), ...spec.tools.map((tool) => tool.name)],
    customTools: spec.tools,
    sessionManager: spec.sessionManager,
    settingsManager,
    modelRuntime,
    resourceLoader,
  })

  const { refreshApiKey, redactionSecrets } = spec
  if (refreshApiKey) {
    const providerName = spec.model.providerName
    // Pi asks before every provider request, so a token that expires mid-turn is replaced.
    session.agent.getApiKey = async (requestedProvider) => {
      if (requestedProvider !== piProviderName(providerName)) return undefined
      try {
        const token = await refreshApiKey(providerName)
        if (token && !redactionSecrets.includes(token)) redactionSecrets.push(token)
        return token || undefined
      } catch {
        // Let Pi report a clean "no auth" error instead of throwing out of its callback.
        return undefined
      }
    }
  }
  return { session, redactionSecrets, dispose: () => session.dispose() }
}

type TurnOptions = Omit<CreateBazilionSessionOptions, 'conversation'>

/** The tools and prompt a turn of this Agent gets, given the hosts in `opts`. */
function turnSurface(opts: TurnOptions) {
  const { agent, paths, env } = opts
  const cwd = agent.team.path
  const promptSkills = loadPromptSkills(paths.skillsDir, agent.skills)
  const shellTools = createSessionShellTools(cwd, env, {
    docker: opts.docker,
    containerPrefix: homeContainerPrefix(paths.home),
    inputsDir: join(agent.agent.dir, 'uploads'),
    skillMounts: promptSkills.map((skill) => ({ source: skill.hostDir, target: skill.sandboxDir })),
    approvalHost: opts.bashApprovalHost,
  })
  const docker = shellTools.config.sandboxMode === 'docker'
  const customTools = createBazilionCustomTools({
    agent,
    memory: opts.memory,
    messagingHost: opts.messagingHost,
    userMdHost: opts.userMdHost,
    browserHost: opts.browserHost,
    mcpHost: opts.mcpHost,
    mcpTools: opts.mcpTools,
    fileSink: opts.fileSink,
    imageGenerationHost: opts.imageGenerationHost,
    webSearchHost: opts.webSearchHost,
    askUser: opts.askUser,
    env,
  })
  const promptOptions: BuildSystemPromptOptions = {
    skills: promptSkills,
    sandboxMode: shellTools.config.sandboxMode,
    // The guides ride along exactly when their tools are admitted.
    ...(opts.browserHost ? { browserGuide: true } : {}),
    ...(opts.webSearchHost ? { searchGuide: true } : {}),
  }
  return {
    cwd,
    // In Docker mode the host Team path does not exist where bash runs, so the model is given
    // the container's working directory instead.
    modelCwd: docker ? containerWorkdir(opts.docker?.cwd ?? '.') : cwd,
    docker,
    tools: shellTools.customBash ? [...customTools, shellTools.customBash] : customTools,
    hostToolNames: shellTools.hostToolNames,
    promptOptions,
  }
}

/** A Pi session for one Agent turn (worker) or for `/compact` (daemon). */
export async function createBazilionSession(
  opts: CreateBazilionSessionOptions,
): Promise<BazilionSessionHandle> {
  const { agent, paths } = opts
  const { providerName, modelId } = parseModelString(agent.model)
  // The Team directory is the workspace: Pi's host coding tools work there; in Docker mode it is
  // bash's only read/write mount. Private identity files are reached through `home_*` tools.
  if (!existsSync(agent.team.path)) mkdirSync(agent.team.path, { recursive: true })
  mkdirSync(join(paths.agentDir(agent.agent.id), 'sessions'), { recursive: true })
  const sessionManager = openConversation(agent, paths, opts.conversation)
  const turn = turnSurface(opts)
  return openPiSession({
    model: {
      providerName,
      modelId,
      env: opts.env,
      ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
    },
    reasoningLevel: agent.reasoningLevel,
    cwd: turn.modelCwd,
    piAgentDir: join(paths.home, 'pi'),
    sessionManager,
    appendSystemPrompt: buildSystemPrompt(agent, turn.promptOptions),
    agentsFiles: (opts.repositoryInstructions ?? []).map((file) => ({
      path: `${turn.docker ? '/workspace' : turn.cwd}/${file.path}`,
      content: file.content,
    })),
    tools: turn.tools,
    hostToolNames: turn.hostToolNames,
    redactionSecrets: [...new Set(envSecretValues(opts.env).filter(Boolean))],
    refreshApiKey: opts.refreshApiKey,
  })
}

/** What the model is told about a tool. */
type ToolDescription = Pick<ToolDefinition, 'name' | 'description' | 'parameters'>

const HOST_TOOL_DEFINITIONS: Record<string, (cwd: string) => ToolDescription> = {
  read: createReadToolDefinition,
  bash: createBashToolDefinition,
  edit: createEditToolDefinition,
  write: createWriteToolDefinition,
  grep: createGrepToolDefinition,
  find: createFindToolDefinition,
  ls: createLsToolDefinition,
}

/**
 * The prompt sections and tools a turn would get, for the context report. Builds no model
 * runtime and no session.
 */
export function describeTurn(opts: TurnOptions): {
  systemPrompt: string
  promptSections: PromptSection[]
  tools: ToolDescription[]
} {
  const turn = turnSurface(opts)
  const hostTools = turn.hostToolNames.flatMap((name) => {
    const define = HOST_TOOL_DEFINITIONS[name]
    return define ? [define(turn.modelCwd)] : []
  })
  return {
    systemPrompt: buildSystemPrompt(opts.agent, turn.promptOptions),
    promptSections: buildSystemPromptSections(opts.agent, turn.promptOptions),
    tools: [...hostTools, ...turn.tools],
  }
}

/** Counts and Pi's token estimate (chars / 4) for what a conversation's branch sends the model. */
export function conversationUsage(conversation: SessionManager): {
  messageEntries: number
  compactionEntries: number
  tokens: number
} {
  const branch = conversation.getBranch()
  return {
    messageEntries: branch.filter(
      (entry) => entry.type === 'message' && entry.message.role !== 'system',
    ).length,
    compactionEntries: branch.filter((entry) => entry.type === 'compaction').length,
    tokens: conversation
      .buildSessionContext()
      .messages.reduce((total, message) => total + estimateTokens(message), 0),
  }
}

/** The scratch-only learning reviewer: exactly the caller's proposal tool, no workspace. */
export async function createRestrictedReviewSession(
  opts: CreateRestrictedReviewSessionOptions,
): Promise<BazilionSessionHandle> {
  const { runtime, scratch } = opts
  return openPiSession({
    model: {
      providerName: runtime.providerName,
      modelId: runtime.modelId,
      env: reviewCredentialEnv(runtime, scratch),
      ...(runtime.apiKey ? { apiKey: runtime.apiKey } : {}),
      ...(runtime.baseUrl ? { baseUrl: runtime.baseUrl } : {}),
    },
    reasoningLevel: runtime.reasoningLevel,
    cwd: '/review',
    piAgentDir: scratch.piAgentDir,
    sessionManager: SessionManager.create(scratch.reviewCwd, scratch.reviewSessionDir),
    systemPrompt: opts.systemPrompt,
    tools: opts.tools,
    redactionSecrets: [...new Set(reviewRuntimeSecrets(runtime))],
    refreshApiKey: opts.refreshApiKey,
  })
}

/** The review's projected credential fields; Vertex JSON becomes a 0600 file in its scratch. */
function reviewCredentialEnv(
  runtime: ReviewProviderRuntime,
  scratch: MinimalWorkerScratch,
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const field of runtime.credentialEnv ?? []) env[field.name] = field.value
  if (runtime.credentialFile) {
    const path = join(scratch.tempDir, 'provider-credential.json')
    writeFileSync(path, runtime.credentialFile.content, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    })
    env[runtime.credentialFile.envName] = path
  }
  return env
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
 * Open an Agent's conversation file for reading or moving its leaf, without a model or session.
 * Throws when the target is not a valid canonical session file of this Agent.
 */
export function openConversation(
  agent: ResolvedAgent,
  paths: Paths,
  target: ConversationTarget,
): SessionManager {
  const sessionDir = join(paths.agentDir(agent.agent.id), 'sessions')
  return SessionManager.open(
    explicitConversationFile(sessionDir, target),
    sessionDir,
    agent.team.path,
  )
}

/**
 * The resolved message view of an Agent's conversation, read straight from its file. Empty when
 * there is no conversation yet.
 */
export function loadInitialMessages(
  agent: ResolvedAgent,
  paths: Paths,
  target?: ConversationTarget | null,
): AgentMessage[] {
  if (!target) return []
  const entries = readSessionFile(join(paths.agentDir(agent.agent.id), 'sessions'), target.id)
  return buildSessionContext(entries.filter((entry) => entry.type !== 'session')).messages
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
  target?: ConversationTarget | null,
): { file: string | null; size: number } {
  const sessionDir = join(paths.agentDir(agent.agent.id), 'sessions')
  if (!existsSync(sessionDir)) return { file: null, size: 0 }
  const recent = target ? explicitConversationFile(sessionDir, target) : null
  if (!recent) return { file: null, size: 0 }
  try {
    const s = statSync(recent)
    return { file: basename(recent), size: s.size }
  } catch {
    return { file: null, size: 0 }
  }
}

/** Never fall back to directory activity when an admitted session is unavailable. */
function explicitConversationFile(
  directory: string,
  target: ConversationTarget | undefined,
): string {
  if (!target) throw new Error('Explicit conversation target is required')
  // Check the id and the header before Pi can repair or recreate a session.
  readSessionHeader(directory, target.id)
  return join(directory, `${target.id}.jsonl`)
}
