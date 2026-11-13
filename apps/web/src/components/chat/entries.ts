// The chat transcript as render entries: persisted history projected from ProviderMessage[], and
// a pure reducer that folds the live turn's SessionEvents into the same shape.

import type {
  Attachment,
  ChatFrame,
  ChatRequest,
  CommandApproval,
  ProviderMessage,
  SessionEvent,
  ToolResultImage,
} from '@bazilion/api-types'

export interface ToolItem {
  /** `progress` is the live output tail of a running call, replaced by its result. */
  kind: 'call' | 'result' | 'error' | 'progress'
  id: string
  name: string
  body: string
}

export type RenderEntry =
  | { type: 'user'; content: string; images?: ToolResultImage[]; files?: { name: string }[] }
  | { type: 'assistant'; content: string }
  | { type: 'tool'; items: ToolItem[] }
  | { type: 'images'; images: ToolResultImage[] }
  | { type: 'result'; resultId: string }
  | { type: 'command_approval'; approval: CommandApproval }
  | { type: 'system'; content: string }
  | { type: 'error'; content: string }

/** A browser turn: risky shell commands and agent questions wait for the user in the chat. */
export function interactiveChatRequest(message: string, attachments: Attachment[]): ChatRequest {
  return { message, attachments, bashApprovalMode: 'interactive', questionMode: 'web' }
}

export function shellApprovalsUrl(agentId: string): string {
  return `/api/shell-approvals?agentId=${encodeURIComponent(agentId)}`
}

export const isImageMime = (mimeType: string) => mimeType.startsWith('image/')

/**
 * Persisted messages as entries: assistant text, then its tool calls and the tool results that
 * answer them grouped into one tool box. Saved results and images are deliverables, so they stand
 * outside the box.
 */
export function projectMessages(messages: ProviderMessage[]): RenderEntry[] {
  const entries: RenderEntry[] = []
  let openTool: { type: 'tool'; items: ToolItem[] } | null = null
  const toolBox = () => {
    if (!openTool) {
      openTool = { type: 'tool', items: [] }
      entries.push(openTool)
    }
    return openTool
  }
  for (const message of messages) {
    if (message.role === 'user') {
      openTool = null
      entries.push({
        type: 'user',
        content: message.content,
        ...(message.images?.length ? { images: message.images } : {}),
      })
    } else if (message.role === 'assistant') {
      if (message.content) {
        openTool = null
        entries.push({ type: 'assistant', content: message.content })
      }
      for (const call of message.toolCalls ?? []) {
        toolBox().items.push({ kind: 'call', id: call.id, name: call.name, body: call.arguments })
      }
    } else if (message.role === 'tool') {
      toolBox().items.push({
        kind: /^error:/i.test(message.content) ? 'error' : 'result',
        id: message.toolCallId ?? '',
        name: message.toolName ?? '',
        body: message.content,
      })
      for (const result of message.results ?? []) {
        entries.push({ type: 'result', resultId: result.resultId })
        openTool = null
      }
      if (message.images?.length) {
        entries.push({ type: 'images', images: message.images })
        openTool = null
      }
    }
  }
  return entries
}

/** Keep one card per shell approval, in the position it first appeared. */
export function upsertCommandApprovalEntry(
  entries: RenderEntry[],
  approval: CommandApproval,
): RenderEntry[] {
  const index = entries.findIndex(
    (entry) => entry.type === 'command_approval' && entry.approval.id === approval.id,
  )
  if (index === -1) return [...entries, { type: 'command_approval', approval }]
  const next = [...entries]
  next[index] = { type: 'command_approval', approval }
  return next
}

/** Insert or replace the live output tail of one running tool call, right after its call line. */
export function upsertToolProgress(
  entries: RenderEntry[],
  event: { id: string; name: string; output: string },
): RenderEntry[] {
  const progress: ToolItem = {
    kind: 'progress',
    id: event.id,
    name: event.name,
    body: event.output,
  }
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (entry?.type !== 'tool') continue
    const call = entry.items.findIndex((item) => item.id === event.id)
    if (call < 0) continue
    const items = [...entry.items]
    const existing = items.findIndex((item) => item.kind === 'progress' && item.id === event.id)
    if (existing >= 0) items[existing] = progress
    else items.splice(call + 1, 0, progress)
    const next = [...entries]
    next[i] = { type: 'tool', items }
    return next
  }
  return appendToolItem(entries, progress)
}

function appendToolItem(entries: RenderEntry[], item: ToolItem): RenderEntry[] {
  const last = entries[entries.length - 1]
  if (last?.type === 'tool') {
    return [...entries.slice(0, -1), { type: 'tool', items: [...last.items, item] }]
  }
  return [...entries, { type: 'tool', items: [item] }]
}

function setAssistantText(entries: RenderEntry[], text: (previous: string) => string) {
  const last = entries[entries.length - 1]
  if (last?.type === 'assistant') {
    return [...entries.slice(0, -1), { type: 'assistant' as const, content: text(last.content) }]
  }
  return [...entries, { type: 'assistant' as const, content: text('') }]
}

/** Fold one live event into the turn's entries. Events without a visible entry change nothing. */
export function applyEvent(entries: RenderEntry[], event: SessionEvent): RenderEntry[] {
  switch (event.type) {
    case 'assistant_delta':
      return setAssistantText(entries, (previous) => previous + event.delta)
    case 'assistant_message':
      return setAssistantText(entries, () => event.text)
    case 'command_approval':
      return upsertCommandApprovalEntry(entries, event.approval)
    case 'tool_progress':
      return upsertToolProgress(entries, event)
    case 'tool_call':
      return appendToolItem(entries, {
        kind: 'call',
        id: event.id,
        name: event.name,
        body: event.arguments,
      })
    case 'tool_result':
    case 'tool_error': {
      // The result replaces the live output tail of its call.
      const cleared = entries.map((entry) =>
        entry.type === 'tool'
          ? {
              ...entry,
              items: entry.items.filter((i) => !(i.kind === 'progress' && i.id === event.id)),
            }
          : entry,
      )
      const item: ToolItem =
        event.type === 'tool_result'
          ? { kind: 'result', id: event.id, name: event.name, body: event.result }
          : { kind: 'error', id: event.id, name: event.name, body: event.error }
      const next = appendToolItem(cleared, item)
      return event.type === 'tool_result' && event.images?.length
        ? [...next, { type: 'images', images: event.images }]
        : next
    }
    case 'file':
      return [...entries, { type: 'result', resultId: event.result.resultId }]
    case 'error':
      return [...entries, { type: 'error', content: `[error] ${event.error}` }]
    default:
      return entries
  }
}

/** Pending shell approvals become terminal when the turn dies. */
export function cancelPendingApprovals(entries: RenderEntry[]): RenderEntry[] {
  return entries.map((entry) =>
    entry.type === 'command_approval' && entry.approval.status === 'pending'
      ? { type: 'command_approval', approval: { ...entry.approval, status: 'cancelled' } }
      : entry,
  )
}

/** Parse an NDJSON response body into frames; malformed lines are skipped. */
export async function* readFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatFrame> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = done ? '' : (lines.pop() ?? '')
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        yield JSON.parse(line) as ChatFrame
      } catch {
        // A partial or foreign line; the next frames still count.
      }
    }
    if (done) return
  }
}
