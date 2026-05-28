// Wire shapes for chat streaming and provider message exchange. The worker
// emits `ChatFrame`s as NDJSON, the daemon forwards them verbatim, every UI
// renders the contained `SessionEvent`s. `ProviderMessage` is the shape both
// the worker (in `done` frames) and clients (when displaying history) speak.

export type Role = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCall {
  id: string
  name: string
  /** JSON-serialized arguments object */
  arguments: string
}

export interface ProviderMessage {
  role: Role
  content: string
  toolCalls?: ToolCall[]
  /** for role='tool': links the result back to the originating call */
  toolCallId?: string
  /** for role='tool': name of the tool that produced this result. Pi requires it on ToolResultMessage. */
  toolName?: string
}

export interface ToolDef {
  name: string
  description: string
  /** JSON Schema for the tool's arguments object */
  parameters: object
}

/** An image produced by a tool result (e.g. a browser screenshot). */
export interface ToolResultImage {
  /** base64-encoded image bytes (no data: prefix). */
  data: string
  /** e.g. "image/png". */
  mimeType: string
}

export type SessionEvent =
  | { type: 'user_message'; text: string }
  | { type: 'assistant_delta'; delta: string }
  | { type: 'assistant_message'; text: string }
  | { type: 'tool_call'; id: string; name: string; arguments: string }
  | {
      type: 'tool_result'
      id: string
      name: string
      result: string
      /** Images emitted by the tool (browser screenshots, MCP image results). */
      images?: ToolResultImage[]
    }
  | { type: 'tool_error'; id: string; name: string; error: string }
  | { type: 'error'; error: string }

/**
 * The wire envelope the worker emits on stdout (NDJSON, one per line) and
 * the chat HTTP endpoint forwards verbatim to clients.
 *
 * - `event`: one per SessionEvent emitted during the turn
 * - `done`:  sent exactly once at the end of a successful turn with the
 *            final message list
 * - `fatal`: sent at most once when the worker itself fails before/after
 *            the turn can run — distinct from an `error` SessionEvent which
 *            lives within a completed turn
 */
export type ChatFrame =
  | { kind: 'event'; event: SessionEvent }
  | { kind: 'done'; messages: ProviderMessage[] }
  | { kind: 'fatal'; error: string }
