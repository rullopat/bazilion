import { isDeepStrictEqual } from 'node:util'

/** Closed structural diagnostics only; never identifiers, queries, URLs or provider text. */
export interface NativeEvidenceFacts {
  terminal: 'json' | 'completed' | 'done' | 'unseen'
  outputItems: number | null
  terminalSearchItems: number
  terminalSearchActions: number
  terminalOtherWebActions: number
  streamedSearchItems: number
  searchProgressEvents: number
}
const CAP = 129 // Counts saturate one above the admitted 128-item response limit.
function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
const PROGRESS = new Set([
  'response.web_search_call.in_progress',
  'response.web_search_call.searching',
  'response.web_search_call.completed',
])
const CONTENT = new Set([
  'response.content_part.added',
  'response.content_part.done',
  'response.output_text.delta',
  'response.output_text.done',
  'response.output_text.annotation.added',
  'response.refusal.delta',
  'response.refusal.done',
  'response.reasoning_summary_part.added',
  'response.reasoning_summary_part.done',
  'response.reasoning_summary_text.delta',
  'response.reasoning_summary_text.done',
  'response.reasoning_text.delta',
  'response.reasoning_text.done',
])
type Slot = { id: string; type: string; added: boolean; completed?: Record<string, unknown> }

/** Completed items are evidence; deltas and progress never become output objects. */
export class NativeSearchEvidence {
  readonly facts: NativeEvidenceFacts = {
    terminal: 'unseen',
    outputItems: null,
    terminalSearchItems: 0,
    terminalSearchActions: 0,
    terminalOtherWebActions: 0,
    streamedSearchItems: 0,
    searchProgressEvents: 0,
  }
  private readonly slots = new Map<number, Slot>()
  private readonly references = new Map<number, { id: string; type?: string }>()
  private readonly positions = new Map<string, number>()
  constructor(private readonly refuse: (message: string) => never) {}

  private bind(index: unknown, id: unknown, type?: string): number {
    if (
      !Number.isInteger(index) ||
      Number(index) < 0 ||
      Number(index) >= 128 ||
      typeof id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(id)
    )
      this.refuse('invalid streamed output identity or index')
    const n = Number(index)
    const prior = this.references.get(n)
    if (
      (prior && (prior.id !== id || (prior.type && type && prior.type !== type))) ||
      (this.positions.has(id) && this.positions.get(id) !== n)
    )
      this.refuse('streamed output identity or type changed')
    this.references.set(n, { id, type: prior?.type ?? type })
    this.positions.set(id, n)
    return n
  }

  observe(event: Record<string, unknown>): void {
    const eventType = typeof event.type === 'string' ? event.type : ''
    if (PROGRESS.has(eventType) || CONTENT.has(eventType)) {
      const search = PROGRESS.has(eventType)
      if (search)
        this.facts.searchProgressEvents = Math.min(CAP, this.facts.searchProgressEvents + 1)
      const type = search
        ? 'web_search_call'
        : eventType.startsWith('response.reasoning_')
          ? 'reasoning'
          : 'message'
      const index = this.bind(event.output_index, event.item_id, type)
      if (this.slots.get(index)?.completed) this.refuse('events after completed output item')
      return
    }
    if (eventType !== 'response.output_item.done' && eventType !== 'response.output_item.added') {
      // Unknown item-bearing events cannot disappear from a completed-item view.
      if ('output_index' in event || 'item_id' in event || 'item' in event)
        this.refuse('unadmitted streamed output event')
      return
    }
    const item = object(event.item)
    if (
      !item ||
      typeof item.type !== 'string' ||
      !['web_search_call', 'message', 'reasoning'].includes(item.type)
    )
      this.refuse('unadmitted streamed output capability')
    const index = this.bind(event.output_index, item.id, item.type)
    const previous = this.slots.get(index)
    if (previous?.completed) this.refuse('duplicate or reopened completed output item')
    if (eventType === 'response.output_item.added') {
      if (previous?.added) this.refuse('duplicate streamed output opening')
      if (item.status !== undefined && item.status !== 'in_progress' && item.status !== 'completed')
        this.refuse('invalid streamed output opening status')
      this.slots.set(index, { id: item.id as string, type: item.type, added: true })
      return
    }
    if (item.type === 'web_search_call') {
      this.facts.streamedSearchItems = Math.min(CAP, this.facts.streamedSearchItems + 1)
      if (item.status !== 'completed') this.refuse('streamed hosted search did not complete')
      const action = object(item.action)
      if (
        !action ||
        typeof action.type !== 'string' ||
        !['search', 'open_page', 'find_in_page'].includes(action.type)
      )
        this.refuse('unknown streamed hosted action')
    } else if (item.type === 'message') {
      if (item.status !== 'completed' || item.role !== 'assistant' || !Array.isArray(item.content))
        this.refuse('incomplete streamed answer evidence')
    } else if (item.status !== undefined && item.status !== 'completed') {
      this.refuse('incomplete streamed reasoning item')
    }
    this.slots.set(index, {
      id: item.id as string,
      type: item.type,
      added: previous?.added ?? false,
      completed: item,
    })
  }

  terminal(value: unknown, kind: NativeEvidenceFacts['terminal']): void {
    this.facts.terminal = kind
    const output = object(value)?.output
    if (!Array.isArray(output)) return
    this.facts.outputItems = Math.min(CAP, output.length)
    for (const raw of output.slice(0, CAP)) {
      const item = object(raw)
      if (item?.type !== 'web_search_call') continue
      this.facts.terminalSearchItems++
      if (object(item.action)?.type === 'search') this.facts.terminalSearchActions++
      else this.facts.terminalOtherWebActions++
    }
  }

  /** Only Codex SSE's explicitly empty terminal may use actual completed item snapshots.
   * Metadata stays terminal-owned, and facts continue to describe the unmodified terminal.
   * No union with partial/nonempty output, ID synthesis, delta assembly or last-write-wins.
   */
  resolve(
    value: unknown,
    codex: boolean,
  ): { response: unknown; outputSource: 'terminal' | 'completed_stream' } {
    const terminal = object(value)
    if (
      codex &&
      (this.facts.terminal === 'completed' || this.facts.terminal === 'done') &&
      Array.isArray(terminal?.output) &&
      terminal.output.length === 0 &&
      this.references.size > 0
    ) {
      const output: Record<string, unknown>[] = []
      for (let index = 0; index < this.references.size; index++) {
        const item = this.slots.get(index)?.completed
        if (!item) this.refuse('incomplete or noncontiguous completed stream evidence')
        output.push(item)
      }
      const response = { ...terminal, output }
      this.reconcile(response)
      return { response, outputSource: 'completed_stream' }
    }
    this.reconcile(value)
    return { response: value, outputSource: 'terminal' }
  }

  private reconcile(value: unknown): void {
    if (!this.references.size) return
    const output = object(value)?.output
    if (!Array.isArray(output) || output.length > 128)
      this.refuse('missing or excessive terminal output for streamed evidence')
    for (const [index, ref] of this.references) {
      const item = object(output[index])
      if (!item || item.id !== ref.id || (ref.type && item.type !== ref.type))
        this.refuse('streamed output identity or type disagrees with terminal output')
      if (ref.type === 'web_search_call' && item.status !== 'completed')
        this.refuse('streamed hosted search progress disagrees with terminal output')
    }
    for (const [index, slot] of this.slots) {
      if (slot.completed && !isDeepStrictEqual(output[index], slot.completed))
        this.refuse('streamed and terminal completed output evidence disagree')
    }
  }
}
