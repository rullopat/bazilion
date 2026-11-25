// The chat transcript as render entries: persisted history projected from ProviderMessage[], and
// a pure reducer that folds the live turn's SessionEvents into the same shape.

import type {
  Attachment,
  ChatFrame,
  ChatRequest,
  CommandApproval,
  CompactionMark,
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
  /** A reply that ended there: stopped by the operator, or failed. */
  | { type: 'stopped'; reason: 'cancelled' | 'failed' }
  /** Where the messages above were summarized to make room in the model's window. */
  | { type: 'compacted'; mark: CompactionMark }
  /** A compaction during the turn on screen; the turn's end replaces it with its divider. */
  | { type: 'compacting'; state: 'running' | 'done' | 'failed'; error?: string }

/** A browser turn: risky shell commands and agent questions wait for the user in the chat. */
export function interactiveChatRequest(message: string, attachments: Attachment[]): ChatRequest {
  return { message, attachments, bashApprovalMode: 'interactive', questionMode: 'web' }
}

export function shellApprovalsUrl(agentId: string): string {
  return `/api/shell-approvals?agentId=${encodeURIComponent(agentId)}`
}

export const isImageMime = (mimeType: string) => mimeType.startsWith('image/')

/** The message being sent, shown at once: the `done` frame replaces it with the saved history. */
export function draftEntry(text: string, attachments: Attachment[]): RenderEntry {
  const images = attachments.filter((file) => isImageMime(file.mimeType))
  const files = attachments
    .filter((file) => !isImageMime(file.mimeType))
    .map((file) => ({ name: file.name ?? 'file' }))
  return {
    type: 'user',
    content: text,
    ...(images.length > 0 ? { images } : {}),
    ...(files.length > 0 ? { files } : {}),
  }
}

/**
 * Persisted messages as entries: assistant text, then its tool calls and the tool results that
 * answer them grouped into one tool box. Saved results and images are deliverables, so they stand
 * outside the box.
 */
export function projectMessages(
  messages: ProviderMessage[],
  compactions: readonly CompactionMark[] = [],
): RenderEntry[] {
  const entries: RenderEntry[] = []
  let openTool: { type: 'tool'; items: ToolItem[] } | null = null
  const toolBox = () => {
    if (!openTool) {
      openTool = { type: 'tool', items: [] }
      entries.push(openTool)
    }
    return openTool
  }
  /** The dividers that stand before message `index`, in the order they happened. */
  const dividersAt = (index: number) => {
    for (const mark of compactions) {
      if (mark.index !== index) continue
      openTool = null
      entries.push({ type: 'compacted', mark })
    }
  }
  messages.forEach((message, index) => {
    dividersAt(index)
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
      if (message.stopped) {
        openTool = null
        entries.push({ type: 'stopped', reason: message.stopped })
      }
    } else if (message.role === 'tool') {
      toolBox().items.push({
        kind: message.isError || /^error:/i.test(message.content) ? 'error' : 'result',
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
  })
  // A compaction that kept nothing verbatim stands after everything.
  dividersAt(messages.length)
  return entries
}

/** One tool call with what came of it. */
export interface Step {
  id: string
  name: string
  /** JSON-serialized arguments. */
  args: string
  status: 'running' | 'done' | 'failed'
  /** The result or the error text; the live tail while it runs. */
  output: string
}

/** Pair each call with its result. A result without its call (a cut history) stands alone. */
export function pairSteps(items: readonly ToolItem[]): Step[] {
  const steps: Step[] = []
  const byId = new Map<string, Step>()
  for (const item of items) {
    const known = byId.get(item.id)
    if (item.kind === 'call') {
      const step: Step = {
        id: item.id,
        name: item.name,
        args: item.body,
        status: 'running',
        output: '',
      }
      steps.push(step)
      byId.set(item.id, step)
    } else if (known) {
      if (item.kind === 'progress') known.output = item.body
      else {
        known.status = item.kind === 'error' ? 'failed' : 'done'
        known.output = item.body
      }
    } else if (item.kind !== 'progress') {
      steps.push({
        id: item.id,
        name: item.name,
        args: '',
        status: item.kind === 'error' ? 'failed' : 'done',
        output: item.body,
      })
    }
  }
  return steps
}

/**
 * The transcript as blocks to draw. A run of tool boxes and saved results becomes one `work`
 * block: its steps, then the files it delivered, so files of one turn sit together.
 */
export type TranscriptBlock =
  | {
      type: 'entry'
      /** Position of the entry in the list the blocks were made from. */
      index: number
      entry: Exclude<RenderEntry, { type: 'tool' } | { type: 'result' }>
    }
  | { type: 'work'; index: number; items: ToolItem[]; resultIds: string[] }

export function groupEntries(entries: readonly RenderEntry[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = []
  let work: Extract<TranscriptBlock, { type: 'work' }> | null = null
  entries.forEach((entry, index) => {
    if (entry.type === 'tool' || entry.type === 'result') {
      if (!work) {
        work = { type: 'work', index, items: [], resultIds: [] }
        blocks.push(work)
      }
      if (entry.type === 'tool') work.items.push(...entry.items)
      else work.resultIds.push(entry.resultId)
      return
    }
    work = null
    blocks.push({ type: 'entry', index, entry })
  })
  return blocks
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
    case 'compaction': {
      const entry: RenderEntry = {
        type: 'compacting',
        state: event.state,
        ...(event.error ? { error: event.error } : {}),
      }
      const at = entries.findLastIndex((candidate) => candidate.type === 'compacting')
      return at >= 0 && entries[at]?.type === 'compacting' && entries[at].state === 'running'
        ? entries.map((candidate, index) => (index === at ? entry : candidate))
        : [...entries, entry]
    }
    case 'error':
      // Stopping a turn is not an error: the conversation says where it stopped.
      if (event.error === 'cancelled') return [...entries, { type: 'stopped', reason: 'cancelled' }]
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
