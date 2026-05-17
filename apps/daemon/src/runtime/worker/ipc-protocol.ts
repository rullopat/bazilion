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

export type RpcMethod = 'agentExists' | 'sendMessage' | 'listInbox' | 'markRead' | 'findReplies'

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

export type RpcArgs =
  | { method: 'agentExists'; args: AgentExistsArgs }
  | { method: 'sendMessage'; args: SendMessageArgs }
  | { method: 'listInbox'; args: ListInboxArgs }
  | { method: 'markRead'; args: MarkReadArgs }
  | { method: 'findReplies'; args: FindRepliesArgs }

export type RpcResult =
  | { method: 'agentExists'; value: boolean }
  | { method: 'sendMessage'; value: { messageId: string } }
  | { method: 'listInbox'; value: Message[] }
  | { method: 'markRead'; value: null }
  | { method: 'findReplies'; value: Message[] }

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
