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

import type { Message } from '@bazilion/api-types'

export type RpcMethod =
  | 'agentExists'
  | 'sendMessage'
  | 'listInbox'
  | 'markRead'
  | 'findReplies'
  | 'userMdGet'
  | 'userMdWrite'

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

export interface UserMdGetArgs {
  groupId: string
}

export interface UserMdGetResult {
  content: string
  /** Short content-derived hash. Pass back in `ifMatch` on the next write. */
  etag: string
}

export interface UserMdWriteArgs {
  groupId: string
  content: string
  /** Etag from the most recent get. Write fails with a conflict if it no longer matches. */
  ifMatch: string
}

export interface UserMdWriteResult {
  /** Etag of the newly-stored content — pass to the next write. */
  etag: string
  totalBytes: number
}

export type RpcArgs =
  | { method: 'agentExists'; args: AgentExistsArgs }
  | { method: 'sendMessage'; args: SendMessageArgs }
  | { method: 'listInbox'; args: ListInboxArgs }
  | { method: 'markRead'; args: MarkReadArgs }
  | { method: 'findReplies'; args: FindRepliesArgs }
  | { method: 'userMdGet'; args: UserMdGetArgs }
  | { method: 'userMdWrite'; args: UserMdWriteArgs }

export type RpcResult =
  | { method: 'agentExists'; value: boolean }
  | { method: 'sendMessage'; value: { messageId: string } }
  | { method: 'listInbox'; value: Message[] }
  | { method: 'markRead'; value: null }
  | { method: 'findReplies'; value: Message[] }
  | { method: 'userMdGet'; value: UserMdGetResult }
  | { method: 'userMdWrite'; value: UserMdWriteResult }

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
}

/**
 * Host-side surface for the group-shared USER.md. Daemon implements against
 * `groupRepo.get` + `setUserMd`; worker proxies through IPC. Optimistic
 * concurrency via etag: `get` returns a content hash, `write` must echo it
 * back; if the stored content has moved on in the meantime the write fails
 * with a typed conflict the model handles by re-reading.
 */
export interface UserMdHost {
  get(groupId: string): UserMdGetResult | Promise<UserMdGetResult>
  write(
    groupId: string,
    content: string,
    ifMatch: string,
  ): UserMdWriteResult | Promise<UserMdWriteResult>
}
