// Translator: pi `AgentSessionEvent` → Bazilion `SessionEvent[]`.
//
// The worker's NDJSON wire format (`ChatFrame`) is still the same discrete
// event stream CLI / browser clients know how to render. This module is the
// adapter at the single choke-point — pi event in, zero-or-more Bazilion
// events out.
//
// Coverage:
//   - user message_start   → one `user_message`
//   - assistant text_delta → one `assistant_delta` per chunk
//   - assistant message_end:
//       - if the message carries text   → one `assistant_message`
//       - for every tool-call content   → one `tool_call`
//   - tool_execution_update → one `tool_progress` (cumulative live output tail, paced by
//                             `paceToolProgress` in the worker)
//   - tool_execution_end   → `tool_result` or `tool_error` based on isError
//   - message_end with aborted/error stopReason → one `error`
//
// Tool output (live progress, results, errors and history) is redacted here, in one place, with
// the session's credential values.
//
// Not surfaced (intentional):
//   - agent_start / agent_end      — run-row lifecycle, not chat events
//   - turn_start / turn_end        — too chatty, nothing to render
//   - message_start (assistant)    — text will come via updates + end
//   - message_update (non-text)    — thinking deltas etc; left for a later
//                                    pass when UIs render thinking blocks
//   - queue_update / compaction_*  — session meta, not assistant output
//   - auto_retry_*                 — silently retried, user sees only the
//                                    eventual success or failure

import type { ProviderMessage, SessionEvent, ToolCall, ToolResultImage } from '@bazilion/api-types'
import type { AgentMessage, AgentToolResult } from '@earendil-works/pi-agent-core'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import { redactExactValues } from '../worker/runtime.ts'

/** Live output is a bounded tail; the final tool result carries the complete (truncated) output. */
const PROGRESS_TAIL_CHARS = 8 * 1024
/** Live output of one tool call is sent at most this often (Pi's bash updates every 100 ms). */
const PROGRESS_INTERVAL_MS = 250

export function translatePiEvent(
  e: AgentSessionEvent,
  secrets: readonly string[] = [],
): SessionEvent[] {
  switch (e.type) {
    case 'message_start': {
      if (e.message.role === 'user') {
        return [{ type: 'user_message', text: stringifyContent(e.message.content) }]
      }
      return []
    }

    case 'message_update': {
      const inner = e.assistantMessageEvent
      if (inner.type === 'text_delta') {
        return [{ type: 'assistant_delta', delta: inner.delta }]
      }
      return []
    }

    case 'message_end': {
      const m = e.message
      if (m.role !== 'assistant') return []
      const out: SessionEvent[] = []
      const text = extractAssistantText(m as AssistantMessage)
      if (text) out.push({ type: 'assistant_message', text })
      for (const block of (m as AssistantMessage).content ?? []) {
        if (block.type === 'toolCall') {
          out.push({
            type: 'tool_call',
            id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.arguments ?? {}),
          })
        }
      }
      const stopReason = (m as AssistantMessage).stopReason
      if (stopReason === 'aborted' || stopReason === 'error') {
        const errText = (m as AssistantMessage).errorMessage ?? stopReason
        out.push({ type: 'error', error: errText })
      }
      return out
    }

    case 'tool_execution_update': {
      // Cumulative partial results (Pi's bash streams its output so far): each update replaces
      // the previous one for the same call.
      const output = progressTail(extractToolResultText(e.partialResult), secrets)
      if (!output) return []
      return [{ type: 'tool_progress', id: e.toolCallId, name: e.toolName, output }]
    }

    case 'tool_execution_end': {
      const text = redactExactValues(extractToolResultText(e.result), secrets)
      if (e.isError) {
        return [{ type: 'tool_error', id: e.toolCallId, name: e.toolName, error: text }]
      }
      const images = extractToolResultImages(e.result)
      return [
        {
          type: 'tool_result',
          id: e.toolCallId,
          name: e.toolName,
          result: text,
          ...(images.length > 0 ? { images } : {}),
        },
      ]
    }

    default:
      return []
  }
}

/**
 * Pace live output: per tool call only the latest tail is kept and sent at most every
 * `intervalMs`, and a pending tail is always sent before the call's result. Other events pass
 * straight through.
 */
export function paceToolProgress(
  send: (event: SessionEvent) => void,
  intervalMs = PROGRESS_INTERVAL_MS,
): { send(event: SessionEvent): void; stop(): void } {
  const calls = new Map<
    string,
    { sentAt: number; pending?: SessionEvent; timer?: ReturnType<typeof setTimeout> }
  >()
  const flush = (id: string) => {
    const call = calls.get(id)
    if (!call?.pending) return
    clearTimeout(call.timer)
    const event = call.pending
    call.pending = undefined
    call.timer = undefined
    call.sentAt = Date.now()
    send(event)
  }
  return {
    send(event) {
      if (event.type === 'tool_progress') {
        const call = calls.get(event.id) ?? { sentAt: 0 }
        calls.set(event.id, call)
        call.pending = event
        const wait = call.sentAt + intervalMs - Date.now()
        if (wait <= 0) flush(event.id)
        else call.timer ??= setTimeout(() => flush(event.id), wait)
        return
      }
      if (event.type === 'tool_result' || event.type === 'tool_error') {
        flush(event.id)
        calls.delete(event.id)
      }
      send(event)
    },
    /** Drop what is still pending: the turn is over. */
    stop() {
      for (const call of calls.values()) clearTimeout(call.timer)
      calls.clear()
    },
  }
}

function extractAssistantText(m: AssistantMessage): string {
  let out = ''
  for (const block of m.content ?? []) {
    if (block.type === 'text') out += block.text
  }
  return out
}

function extractAssistantToolCalls(m: AssistantMessage): ToolCall[] {
  const out: ToolCall[] = []
  for (const block of m.content ?? []) {
    if (block.type === 'toolCall') {
      out.push({
        id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.arguments ?? {}),
      })
    }
  }
  return out
}

/** Flatten `AgentToolResult.content` blocks into a single string — matches the
 *  shape Bazilion tools always returned before pi adoption. */
export function extractToolResultText(result: unknown): string {
  const r = result as AgentToolResult<unknown> | undefined
  if (!r?.content) return ''
  let out = ''
  for (const block of r.content) {
    if (block.type === 'text') out += block.text
  }
  return out
}

/** Pull image blocks out of a tool result (browser screenshots, MCP images). */
export function extractToolResultImages(result: unknown): ToolResultImage[] {
  const r = result as AgentToolResult<unknown> | undefined
  if (!r?.content) return []
  const out: ToolResultImage[] = []
  for (const block of r.content) {
    if (block.type === 'image') {
      const b = block as { data?: string; mimeType?: string }
      if (typeof b.data === 'string' && typeof b.mimeType === 'string') {
        out.push({ data: b.data, mimeType: b.mimeType })
      }
    }
  }
  return out
}

/**
 * Redact a cumulative live output and keep its tail. A trailing prefix of a credential is held
 * back, because the rest of it may only arrive with the next update. A cut tail starts on a line
 * boundary, so clients can line successive tails up; only a single line longer than the whole
 * tail is cut mid-line.
 */
function progressTail(text: string, secrets: readonly string[]): string {
  let output = redactExactValues(text, secrets)
  let end = output.length
  for (const secret of secrets) {
    for (let start = Math.max(0, output.length - secret.length + 1); start < end; start++) {
      let matches = true
      for (let i = start; i < output.length && matches; i++)
        matches = output.charCodeAt(i) === secret.charCodeAt(i - start)
      if (matches) {
        end = start
        break
      }
    }
  }
  output = output.slice(0, end)
  if (output.length <= PROGRESS_TAIL_CHARS) return output
  const cut = output.length - PROGRESS_TAIL_CHARS
  const lineStart = output.indexOf('\n', cut - 1) + 1
  // The output's final newline starts no line: the tail would be empty.
  if (lineStart > 0 && lineStart < output.length) return output.slice(lineStart)
  // Never start on the second half of a surrogate pair.
  const first = output.charCodeAt(cut)
  return output.slice(first >= 0xdc00 && first <= 0xdfff ? cut + 1 : cut)
}

/** Stringify a pi user-message content array. */
function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const block of content as { type: string; text?: string }[]) {
    if (block.type === 'text' && typeof block.text === 'string') out += block.text
  }
  return out
}

/**
 * Convert pi's authoritative `session.state.messages` (AgentMessage[]) into
 * Bazilion's ProviderMessage[] shape, so the `done` ChatFrame stays
 * compatible with browser + CLI clients that rehydrate from it.
 *
 * Notes on role mapping: pi uses `"toolResult"` for tool-response messages;
 * Bazilion uses `"tool"`. AssistantMessage content arrays become either
 * `content` string (text blocks joined) or a `toolCalls` array (toolCall
 * blocks converted).
 */
export function piMessagesToProviderView(
  messages: AgentMessage[],
  secrets: readonly string[] = [],
): ProviderMessage[] {
  const out: ProviderMessage[] = []
  for (const m of messages) {
    // Custom Bazilion message types would land in this switch too, but we
    // don't register any via CustomAgentMessages declaration merging yet.
    switch (m.role) {
      case 'user': {
        const content = (m as { content: unknown }).content
        const images = extractToolResultImages({ content })
        out.push({
          role: 'user',
          content: stringifyContent(content),
          ...(images.length > 0 ? { images } : {}),
        })
        break
      }
      case 'assistant': {
        const am = m as AssistantMessage
        const text = extractAssistantText(am)
        const toolCalls = extractAssistantToolCalls(am)
        const msg: ProviderMessage = { role: 'assistant', content: text }
        if (toolCalls.length > 0) msg.toolCalls = toolCalls
        out.push(msg)
        break
      }
      case 'toolResult': {
        const tr = m as { content: unknown; toolCallId?: string; toolName?: string }
        const images = extractToolResultImages({ content: tr.content })
        out.push({
          role: 'tool',
          content: redactExactValues(stringifyContent(tr.content), secrets),
          toolCallId: tr.toolCallId,
          toolName: tr.toolName,
          results: extractResultReferences(m),
          ...(images.length > 0 ? { images } : {}),
        })
        break
      }
      default:
        // System and other unknown roles are skipped — the runtime's system
        // prompt is already wired via pi's settingsManager + our buildSystemPrompt.
        break
    }
  }
  return out
}

/** Saved-file references from a tool result's details; never paths or inline bytes. */
function extractResultReferences(
  value: unknown,
): import('@bazilion/api-types').ResultReference[] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const refs = (value as { details?: { results?: unknown } }).details?.results
  if (!Array.isArray(refs)) return undefined
  return refs.flatMap((ref) => {
    const id = (ref as { resultId?: unknown } | null)?.resultId
    return typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id) ? [{ resultId: id }] : []
  })
}
