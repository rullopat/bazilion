// Wire shapes for chat streaming and provider message exchange. The worker
// emits `ChatFrame`s as NDJSON, the daemon forwards them verbatim, every UI
// renders the contained `SessionEvent`s. `ProviderMessage` is the shape both
// the worker (in `done` frames) and clients (when displaying history) speak.

import type { CompactionMark, ContextUse } from './chat.ts'
import type { AgentQuestion } from './questions.ts'
import type { ResultReference } from './results.ts'

export type Role = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCall {
  id: string
  name: string
  /** JSON-serialized arguments object */
  arguments: string
}

export interface ProviderMessage {
  /** for role='tool': files the tool saved as results (deliver_file, image_generate). */
  results?: ResultReference[]
  role: Role
  content: string
  toolCalls?: ToolCall[]
  /** for role='tool': links the result back to the originating call */
  toolCallId?: string
  /** for role='tool': name of the tool that produced this result. Pi requires it on ToolResultMessage. */
  toolName?: string
  /** for role='tool': images the tool emitted (browser screenshots, MCP image results). */
  images?: ToolResultImage[]
  /** for role='tool': the call failed or was refused, so nothing it asked for happened. */
  isError?: boolean
  /** for role='assistant': the reply ended there, stopped by the operator or failed. */
  stopped?: 'cancelled' | 'failed'
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

/** Whether a turn has a human response path for dangerous shell commands. */
export type BashApprovalMode = 'interactive' | 'auto_deny'

export type CommandRiskCode =
  | 'sensitive-path-read'
  | 'broad-destructive-operation'
  | 'remote-pipe-execution'
  | 'outbound-exfiltration'
  | 'privilege-or-credential-access'
  /** An MCP tool that sends or changes something outside, set to ask first. */
  | 'outward-action'

export interface CommandRisk {
  code: CommandRiskCode
  message: string
  /** Inclusive/exclusive UTF-16 offsets into the original command. */
  span: { start: number; end: number }
}

export type CommandApprovalStatus =
  | 'pending'
  | 'allowed'
  | 'denied'
  | 'auto_denied'
  | 'expired'
  | 'cancelled'

/** Ephemeral, turn-scoped shell approval state. It is never a Team Policy approval. */
export interface CommandApproval {
  id: string
  turnId: string
  toolCallId: string
  agentId: string
  teamId: string
  command: string
  risks: CommandRisk[]
  /**
   * Set for an MCP tool that asks first (`server · tool`): `command` is then the tool and its
   * arguments, not a shell command.
   */
  tool?: string
  status: CommandApprovalStatus
  /** Allowed without asking, by this rule of the Agent's (the prefix it matched). */
  rule?: string
  /** What the review model said, when one answered first (BAZILION_BASH_APPROVAL=review). */
  review?: CommandReview
  /**
   * The prefix "Always for this Agent" offers: the program and its subcommand (`git push`). Only
   * for a single simple command, the only kind a rule can allow.
   */
  suggestedRule?: string
  /** When the Agent asked, epoch milliseconds. */
  createdAt: number
  /** Epoch milliseconds. */
  expiresAt: number
}

/** The review model's answer: allowed, refused, or passed on to the owner. */
export interface CommandReview {
  decision: 'allow' | 'deny' | 'ask'
  reason: string
  /** `provider:model` */
  model: string
}

/** A command an Agent may run without asking: one that starts with `prefix`, word for word. */
export interface CommandRule {
  id: string
  agentId: string
  prefix: string
  createdAt: number
}

export interface ListCommandRulesResponse {
  rules: CommandRule[]
}

export type SessionEvent =
  | { type: 'agent_question'; question: AgentQuestion }
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
  | {
      /** A file the Agent saved for the user (deliver_file, image_generate); fetch it by result id. */
      type: 'file'
      result: ResultReference
      name: string
      mimeType: string
    }
  | { type: 'command_approval'; approval: CommandApproval }
  | {
      /**
       * Live output of a running tool (e.g. bash). Cumulative: each update for the same `id`
       * replaces the previous one. A bounded, redacted tail; the tool result follows.
       */
      type: 'tool_progress'
      /** Tool-call id. */
      id: string
      name: string
      output: string
    }
  | { type: 'error'; error: string }
  /**
   * The conversation neared the model's window, or a reply was cut short by it: older messages
   * are being summarized (`running`), then were (`done`), or could not be (`failed`).
   */
  | { type: 'compaction'; state: 'running' | 'done' | 'failed'; error?: string }

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
  | {
      kind: 'done'
      /** The whole conversation after the turn, as `GET …/sessions/messages` gives it. */
      messages: ProviderMessage[]
      compactions?: CompactionMark[]
      context?: ContextUse
    }
  | { kind: 'fatal'; error: string }
