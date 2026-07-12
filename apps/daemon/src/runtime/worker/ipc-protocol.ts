// Worker ↔ daemon IPC protocol.
//
// The daemon is the single owner of `~/.bazilion`. Worker subprocesses run
// agent turns without their own SQLite handle: anything that needs DB access
// during a turn (currently the `send_message` / `read_inbox` /
// `wait_for_reply` tools) is delegated to the parent over Node's built-in
// `process.send` / `child.send` IPC channel (set up via `stdio: 'ipc'`).
//
// Wire format: one JSON object per `send`, with a stable `type` discriminator
// and a correlation `id` for matching replies. The shape stays narrow on
// purpose — only the messaging tools talk over IPC. Agent resolution,
// provider gate, and merged env are pre-computed in the daemon and handed to
// the worker on stdin (see `WorkerInput` in `worker/entry.ts`).

import type { CommunicationApproval, Message } from '@bazilion/api-types'
import type { ToolResultPart } from '../tools/types.ts'

export type RpcMethod =
  | 'agentExists'
  | 'sendMessage'
  | 'listInbox'
  | 'markRead'
  | 'findReplies'
  | 'approvalStatus'
  | 'userMdGet'
  | 'userMdWrite'
  | 'browserInvoke'
  | 'mcpInvoke'

export interface AgentExistsArgs {
  agentId: string
}

export interface SendMessageArgs {
  from: string
  to: string
  payload: string
  replyTo: string | null
}

export interface ListInboxArgs {
  agentId: string
  unreadOnly: boolean
}

export interface MarkReadArgs {
  messageId: string
}

export interface FindRepliesArgs {
  agentId: string
  replyTo: string
}

export interface ApprovalStatusArgs {
  agentId: string
  approvalId: string
}

export interface UserMdGetArgs {
  teamId: string
}

export interface UserMdGetResult {
  content: string
  /** Short content-derived hash. Pass back in `ifMatch` on the next write. */
  etag: string
}

export interface UserMdWriteArgs {
  teamId: string
  content: string
  /** Etag from the most recent get. Write fails with a conflict if it no longer matches. */
  ifMatch: string
}

export interface UserMdWriteResult {
  /** Etag of the newly-stored content — pass to the next write. */
  etag: string
  totalBytes: number
}

export interface BrowserInvokeArgs {
  agentId: string
  action: string
  args: Record<string, unknown>
}

export interface McpInvokeArgs {
  serverId: string
  toolName: string
  args: Record<string, unknown>
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

export type RpcArgs =
  | { method: 'agentExists'; args: AgentExistsArgs }
  | { method: 'sendMessage'; args: SendMessageArgs }
  | { method: 'listInbox'; args: ListInboxArgs }
  | { method: 'markRead'; args: MarkReadArgs }
  | { method: 'findReplies'; args: FindRepliesArgs }
  | { method: 'approvalStatus'; args: ApprovalStatusArgs }
  | { method: 'userMdGet'; args: UserMdGetArgs }
  | { method: 'userMdWrite'; args: UserMdWriteArgs }
  | { method: 'browserInvoke'; args: BrowserInvokeArgs }
  | { method: 'mcpInvoke'; args: McpInvokeArgs }

export type RpcResult =
  | { method: 'agentExists'; value: boolean }
  | { method: 'sendMessage'; value: { messageId: string } }
  | { method: 'listInbox'; value: Message[] }
  | { method: 'markRead'; value: null }
  | { method: 'findReplies'; value: Message[] }
  | { method: 'approvalStatus'; value: CommunicationApproval | null }
  | { method: 'userMdGet'; value: UserMdGetResult }
  | { method: 'userMdWrite'; value: UserMdWriteResult }
  | { method: 'browserInvoke'; value: ToolResultPart[] }
  | { method: 'mcpInvoke'; value: ToolResultPart[] }

export type IpcRequest = { type: 'rpc'; id: string } & RpcArgs

export type IpcReply =
  | { type: 'rpc-reply'; id: string; ok: true; result: unknown }
  | { type: 'rpc-reply'; id: string; ok: false; error: string }

/**
 * The host-side surface the worker delegates messaging operations to. The
 * daemon implements this against `messageRepo` / `agentRepo`; tests can
 * provide an in-memory shim.
 */
export interface MessagingHost {
  agentExists(agentId: string): boolean | Promise<boolean>
  sendMessage(input: SendMessageArgs): { messageId: string } | Promise<{ messageId: string }>
  listInbox(agentId: string, opts: { unreadOnly: boolean }): Message[] | Promise<Message[]>
  markRead(messageId: string): void | Promise<void>
  findReplies(agentId: string, replyTo: string): Message[] | Promise<Message[]>
  approvalStatus(
    agentId: string,
    approvalId: string,
  ): CommunicationApproval | null | Promise<CommunicationApproval | null>
}

/**
 * Host-side surface for the team-shared USER.md. Daemon implements against
 * `teamRepo.get` + `setUserMd`; worker proxies through IPC. Optimistic
 * concurrency via etag: `get` returns a content hash, `write` must echo it
 * back; if the stored content has moved on in the meantime the write fails
 * with a typed conflict the model handles by re-reading.
 */
export interface UserMdHost {
  get(teamId: string): UserMdGetResult | Promise<UserMdGetResult>
  write(
    teamId: string,
    content: string,
    ifMatch: string,
  ): UserMdWriteResult | Promise<UserMdWriteResult>
}

/**
 * Host-side surface for the per-agent browser session. Daemon implements it
 * against the Playwright pool in `lib/browser/`; the worker proxies every
 * `browser_*` tool call through IPC. The browser lives in the daemon (stateful,
 * persistent across turns), the worker stays stateless. Returns multimodal tool
 * output (text snapshots + base64 screenshots).
 */
export interface BrowserHost {
  invoke(agentId: string, action: string, args: Record<string, unknown>): Promise<ToolResultPart[]>
}

/**
 * Host-side surface for MCP `tools/call`. Daemon implements it against the
 * connection pool in `lib/mcp/`; the worker proxies each injected MCP tool
 * through IPC. `serverId` + `toolName` identify the upstream tool.
 */
export interface McpHost {
  invoke(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolResultPart[]>
}
