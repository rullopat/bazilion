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
  Message,
  ResultReference,
} from '@bazilion/api-types'
import type { ToolResultPart } from '../tools/types.ts'

/** Every worker-to-daemon call: its arguments and the daemon's answer. */
export interface RpcMethods {
  askUser: { args: { question: AgentQuestionInput }; result: AgentQuestionToolResult }
  publishResult: { args: PublishResultArgs; result: ResultReference }
  generateImages: { args: ImageGenerationInput; result: ImageGenerationOutput }
  webSearch: { args: WebSearchArgs; result: WebSearchOutput }
  agentExists: { args: { agentId: string }; result: boolean }
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
    args: { serverId: string; toolName: string; args: Record<string, unknown> }
    result: ToolResultPart[]
  }
  /** The daemon refreshes the turn's own OAuth credential; only the access token comes back. */
  refreshApiKey: { args: { providerName: string }; result: string }
  bashApproval: { args: BashApprovalArgs; result: CommandApproval }
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
}

/** The saved images; their bytes stay in the daemon's result store. */
export interface ImageGenerationOutput {
  model: string
  files: Array<{ name: string; mimeType: string; result: ResultReference }>
}

export interface WebSearchArgs {
  query: string
  /** Number of results, 1–10 (default 5). */
  count?: number
}

/** Results to read with web_fetch; provider-hosted search also returns its written answer. */
export interface WebSearchOutput {
  backend: 'brave' | 'searxng' | 'openai' | 'openai-codex'
  answer?: string
  results: Array<{ title: string; url: string; snippet: string }>
}

// The daemon side of each tool. The daemon implements them against its repos and resources;
// the worker implements the same interfaces as IPC proxies.

export interface MessagingHost {
  agentExists(agentId: string): boolean | Promise<boolean>
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

/** Dangerous-command approvals, in daemon memory for the length of one turn. */
export interface BashApprovalHost {
  begin(input: BashApprovalArgs, signal?: AbortSignal): BashApprovalHandle
}

/** Bound by the daemon to one owner turn's Agent and conversation; the worker supplies content only. */
export interface QuestionHost {
  ask(
    question: unknown,
    signal?: AbortSignal,
  ): { question: AgentQuestion; result: Promise<AgentQuestionToolResult> }
}

export interface ResultHost {
  publish(input: PublishResultArgs): Promise<ResultReference>
}

export interface ImageGenerationHost {
  generate(input: ImageGenerationInput): Promise<ImageGenerationOutput>
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
  /** Present only for `openai-codex`, whose access token expires during long turns. */
  apiKeyRefreshHost?: ApiKeyRefreshHost
}

export type WorkerHostName = keyof WorkerHosts
