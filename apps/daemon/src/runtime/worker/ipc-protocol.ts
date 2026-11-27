// Worker ↔ daemon IPC protocol.
//
// The daemon is the single owner of `~/.bazilion`. A worker runs one turn without a database
// handle: every tool that needs daemon state (messaging, USER.md, results, browser, MCP, search,
// images, questions, shell approval, OAuth refresh) calls the daemon over the Node IPC channel
// (`stdio: 'ipc'`). One call is `{type: 'rpc', id, method, args}`; the daemon answers
// `{type: 'rpc-reply', id, ok, result | error}`. `RpcMethods` is the whole protocol.

import type {
  AgentQuestion,
  AgentQuestionInput,
  AgentQuestionToolResult,
  BashApprovalMode,
  CommandApproval,
  CommandRisk,
  Job,
  Message,
  ResultReference,
} from '@bazilion/api-types'
import type { ToolResultPart } from '../tools/types.ts'

/** Every worker-to-daemon call: its arguments and the daemon's answer. */
export interface RpcMethods {
  askUser: { args: { question: AgentQuestionInput }; result: AgentQuestionToolResult }
  publishResult: { args: PublishResultArgs; result: ResultReference }
  showResult: { args: { resultId: string }; result: ShownResult }
  generateImages: { args: ImageGenerationInput; result: ImageGenerationOutput }
  webSearch: { args: WebSearchArgs; result: WebSearchOutput }
  sendMessage: { args: SendMessageArgs; result: { messageId: string } }
  listInbox: { args: { agentId: string; unreadOnly: boolean }; result: Message[] }
  markRead: { args: { messageId: string }; result: null }
  findReplies: { args: { agentId: string; replyTo: string }; result: Message[] }
  userMdGet: { args: { teamId: string }; result: UserMdGetResult }
  userMdWrite: {
    args: { teamId: string; content: string; ifMatch: string }
    result: UserMdWriteResult
  }
  browserInvoke: {
    args: { agentId: string; action: string; args: Record<string, unknown> }
    result: ToolResultPart[]
  }
  mcpInvoke: {
    args: {
      serverId: string
      toolName: string
      args: Record<string, unknown>
      /** The model's call, so an approval it needs is tied to it. */
      toolCallId?: string
    }
    result: ToolResultPart[]
  }
  /** The daemon refreshes the turn's own OAuth credential; only the access token comes back. */
  refreshApiKey: { args: { providerName: string }; result: string }
  bashApproval: { args: BashApprovalArgs; result: CommandApproval }
  createAgent: { args: CreateAgentArgs; result: CreatedAgent }
  jobStart: { args: { command: string }; result: JobOutputResult }
  jobList: { args: Record<string, never>; result: Job[] }
  jobOutput: { args: { id: string; waitSeconds?: number }; result: JobOutputResult }
  jobInput: { args: { id: string; text?: string; interrupt?: boolean }; result: Job }
  jobStop: { args: { id: string }; result: Job }
  recallSearch: { args: { query: string }; result: string }
  recallRead: { args: { conversationId: string; from: number; count?: number }; result: string }
}

/** A job with the output the Agent had not read yet. */
export interface JobOutputResult {
  job: Job
  output: string
  /** Earlier unread output was left out (it stays in the job's log). */
  cut: boolean
}

/** Another Agent the turn's Agent may know about: a teammate, or one Team Policy lets it reach. */
export interface AgentContact {
  id: string
  name: string
  /** The name it gave itself, when it is not `name` ("Sales Director" calls itself Sally). */
  calledName?: string
  teamId: string
  teamName: string
  /** The Agent template it was made from, by name. */
  template: string
  /** Team Policy lets the turn's Agent message it now. */
  canMessage: boolean
}

/** A teammate an Agent adds with `agent_create`; the daemon binds it to the Agent's Team. */
export interface CreateAgentArgs {
  name: string
  /** What the new Agent is for: written into its AGENTS.md, so it starts knowing its job. */
  role: string
  /** An Agent template id; the creator's own template when omitted. */
  template?: string
  /** `provider:model`; the creator's model when omitted. */
  model?: string
}

export interface CreatedAgent {
  id: string
  name: string
  teamId: string
  teamName: string
  template: string
  model: string
  /** In a restricted Team: connected with its creator both ways. */
  connected: boolean
}

export type RpcMethod = keyof RpcMethods

export type IpcRequest = {
  [M in RpcMethod]: { type: 'rpc'; id: string; method: M; args: RpcMethods[M]['args'] }
}[RpcMethod]

export type IpcReply =
  | { type: 'rpc-reply'; id: string; ok: true; result: unknown }
  | { type: 'rpc-reply'; id: string; ok: false; error: string }

export interface SendMessageArgs {
  from: string
  to: string
  payload: string
  replyTo: string | null
}

export interface UserMdGetResult {
  content: string
  /** Short content-derived hash. Pass back in `ifMatch` on the next write. */
  etag: string
}

export interface UserMdWriteResult {
  /** Etag of the newly-stored content — pass to the next write. */
  etag: string
  totalBytes: number
}

export interface BashApprovalArgs {
  id: string
  turnId: string
  toolCallId: string
  agentId: string
  teamId: string
  command: string
  risks: CommandRisk[]
  mode: BashApprovalMode
  /** An MCP tool that asks first, as `server · tool`. */
  tool?: string
}

/**
 * An MCP tool discovered daemon-side and shipped to the worker on stdin so it
 * can build a proxy tool for it. The worker never connects to MCP servers — it
 * just exposes these as tools whose `execute` calls back via `mcpInvoke`.
 */
export interface InjectedMcpTool {
  /** Namespaced name the LLM sees: `mcp__<server>__<tool>`. */
  toolName: string
  serverId: string
  /** Original tool name on the server, used in `tools/call`. */
  rawName: string
  /** The server's name, as the operator gave it. */
  serverName?: string
  /** It sends or changes something outside: the operator approves each call. */
  ask?: boolean
  description: string
  inputSchema: object
}

/** A deliver_file file; the daemon binds the Agent, Team and conversation. */
export interface PublishResultArgs {
  toolCallId: string
  name: string
  mimeType: string
  /** base64 */
  data: string
}

export interface ImageGenerationInput {
  toolCallId: string
  prompt: string
  /** Display filename stem. */
  name?: string
  /** Pictures to start from, as paths the Agent sees (workspace or uploads). */
  references?: string[]
  /** Answer at once; the picture is saved when it is ready and wakes the Agent. */
  background?: boolean
}

/** The saved images; their bytes stay in the daemon's result store. */
export interface ImageGenerationOutput {
  model: string
  files: Array<{ name: string; mimeType: string; result: ResultReference }>
  /** Being made in the background: nothing is saved yet. */
  pending?: boolean
}

export interface WebSearchArgs {
  query: string
  /** Number of results, 1–10 (default 5). */
  count?: number
  /** Only results from the last day, week, month or year. */
  freshness?: 'day' | 'week' | 'month' | 'year'
  /** Published on or after / on or before this date, YYYY-MM-DD. */
  after?: string
  before?: string
  /** Only these sites (domains), or none of those in `excludeSites`. */
  sites?: string[]
  excludeSites?: string[]
  /** ISO 3166 two-letter country code, e.g. "IT". */
  country?: string
  /** ISO 639-1 language code, e.g. "it". */
  language?: string
}

/** Results to read with web_fetch; provider-hosted search also returns its written answer. */
export interface WebSearchOutput {
  backend: 'brave' | 'searxng' | 'tavily' | 'exa' | 'openai' | 'openai-codex'
  answer?: string
  results: Array<{ title: string; url: string; snippet: string; published?: string }>
  /** Filters asked for that this backend could not apply. */
  unapplied?: string[]
}

// The daemon side of each tool. The daemon implements them against its repos and resources;
// the worker implements the same interfaces as IPC proxies.

export interface MessagingHost {
  /** `to` is an id, or a name (the sender's teammates first); unknown recipients throw. */
  sendMessage(input: SendMessageArgs): { messageId: string } | Promise<{ messageId: string }>
  listInbox(agentId: string, opts: { unreadOnly: boolean }): Message[] | Promise<Message[]>
  markRead(messageId: string): void | Promise<void>
  findReplies(agentId: string, replyTo: string): Message[] | Promise<Message[]>
}

/**
 * The team-shared USER.md, with optimistic concurrency: `get` returns a content hash, `write`
 * must echo it back and fails with a conflict the model handles by re-reading.
 */
export interface UserMdHost {
  get(teamId: string): UserMdGetResult | Promise<UserMdGetResult>
  write(
    teamId: string,
    content: string,
    ifMatch: string,
  ): UserMdWriteResult | Promise<UserMdWriteResult>
}

/** The Agent's managed browser, which lives in the daemon across turns. */
export interface BrowserHost {
  invoke(agentId: string, action: string, args: Record<string, unknown>): Promise<ToolResultPart[]>
}

/** `tools/call` on the daemon's MCP connection pool. */
export interface McpHost {
  invoke(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    options?: {
      toolCallId?: string
      /** Ends the call, and any approval it waits for: the worker that made it is gone. */
      signal?: AbortSignal
      /** Hears of an approval the call waits for (a tool that asks first), and its outcome. */
      onApproval?: (approval: CommandApproval) => void
    },
  ): Promise<ToolResultPart[]>
}

/** Refreshes the turn's OAuth access token; the stored refresh credential never leaves the daemon. */
export interface ApiKeyRefreshHost {
  refresh(providerName: string, signal?: AbortSignal): Promise<string>
}

export interface BashApprovalHandle {
  /** Pending for interactive requests; auto_denied for non-interactive requests. */
  approval: CommandApproval
  /** The approval once allowed, denied, expired or cancelled. */
  settled: Promise<CommandApproval>
}

/**
 * Dangerous-command approvals, in daemon memory for the length of one turn. A rule or a review
 * model may decide before anyone is asked, so the handle can take a moment to come.
 */
export interface BashApprovalHost {
  begin(
    input: BashApprovalArgs,
    signal?: AbortSignal,
  ): BashApprovalHandle | Promise<BashApprovalHandle>
}

/** Bound by the daemon to one owner turn's Agent and conversation; the worker supplies content only. */
export interface QuestionHost {
  ask(
    question: unknown,
    signal?: AbortSignal,
  ): { question: AgentQuestion; result: Promise<AgentQuestionToolResult> }
}

/** A result already saved, to show again in the chat. */
export interface ShownResult {
  result: ResultReference
  name: string
  mimeType: string
}

export interface ResultHost {
  publish(input: PublishResultArgs): Promise<ResultReference>
  /** One of the Agent's own saved results (a picture made in the background, say). */
  show(resultId: string): Promise<ShownResult>
}

export interface ImageGenerationHost {
  generate(input: ImageGenerationInput): Promise<ImageGenerationOutput>
}

/** The turn's Agent adding a teammate; bound by the daemon to that Agent and its Team. */
export interface TeamHost {
  createAgent(input: CreateAgentArgs): CreatedAgent | Promise<CreatedAgent>
}

/**
 * The turn's Agent's background jobs, which the daemon runs and keeps past the turn. Bound by the
 * daemon to the Agent and the conversation; a job of another Agent is unknown here.
 */
export interface JobHost {
  start(input: { command: string }): Promise<JobOutputResult>
  list(): Promise<Job[]>
  output(
    input: { id: string; waitSeconds?: number },
    signal?: AbortSignal,
  ): Promise<JobOutputResult>
  input(input: { id: string; text?: string; interrupt?: boolean }): Promise<Job>
  stop(input: { id: string }): Promise<Job>
}

/** The turn's Agent's other conversations, for `recall` with `everywhere`. */
export interface RecallHost {
  search(query: string): Promise<string>
  read(conversationId: string, from: number, count?: number): Promise<string>
}

/** Search runs in the daemon, which holds the backend URL and credentials. */
export interface WebSearchHost {
  search(args: WebSearchArgs): Promise<WebSearchOutput>
}

/**
 * The daemon hosts that serve one worker. The worker offers a tool only when its host is
 * present: the spawner tells it which ones are (`WorkerInput.hosts`).
 */
export interface WorkerHosts {
  messagingHost?: MessagingHost
  userMdHost?: UserMdHost
  resultHost?: ResultHost
  bashApprovalHost?: BashApprovalHost
  questionHost?: QuestionHost
  imageGenerationHost?: ImageGenerationHost
  webSearchHost?: WebSearchHost
  browserHost?: BrowserHost
  mcpHost?: McpHost
  /** Only in a turn the operator started: Agents add teammates when asked, not on their own. */
  teamHost?: TeamHost
  jobHost?: JobHost
  recallHost?: RecallHost
  /** Present only for `openai-codex`, whose access token expires during long turns. */
  apiKeyRefreshHost?: ApiKeyRefreshHost
}

export type WorkerHostName = keyof WorkerHosts
