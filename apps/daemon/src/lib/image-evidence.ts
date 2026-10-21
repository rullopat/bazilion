import { isDeepStrictEqual } from 'node:util'

/** Image-specific completed snapshots; never progress/delta reconstruction. */
const CODES = [
  'event',
  'sequence',
  'response',
  'model',
  'failure',
  'identity',
  'snapshot',
  'refusal',
  'limit',
  'terminal',
  'conflict',
  'incomplete',
  'no_images',
] as const
type Code = (typeof CODES)[number]
export class ImageEvidenceError extends Error {
  readonly code: Code
  constructor(code: Code) {
    const safe = CODES.includes(code) ? code : 'event'
    super(`Image evidence refused: ${safe}`)
    this.code = safe
  }
}
function fail(code: Code): never {
  throw new ImageEvidenceError(code)
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('snapshot')
  return value as Record<string, unknown>
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$(?![\s\S])/.test(value))
    fail('identity')
  return value
}
const TYPES = ['image_generation_call', 'message', 'reasoning']
const PROGRESS = new Set([
  'response.image_generation_call.in_progress',
  'response.image_generation_call.generating',
  'response.image_generation_call.completed',
  'response.image_generation_call.partial_image',
])
const MESSAGE = new Set([
  'response.content_part.added',
  'response.content_part.done',
  'response.output_text.delta',
  'response.output_text.done',
])
const REASONING = new Set([
  'response.reasoning_summary_part.added',
  'response.reasoning_summary_part.done',
  'response.reasoning_summary_text.delta',
  'response.reasoning_summary_text.done',
  'response.reasoning_text.delta',
  'response.reasoning_text.done',
])
type Slot = { id: string; type: string; added: boolean; done?: Record<string, unknown> }

/** Does not decode bytes, retain deltas, or turn progress into output.
 * The caller must finish strict bounded SSE parsing, then validate PNG bytes in the shared host.
 */
export class CompletedImageEvidence {
  private readonly slots = new Map<number, Slot>()
  private readonly positions = new Map<string, number>()
  private responseId?: string
  private lifecycle = false
  private sequence = -1
  private events = 0
  private terminal?: Record<string, unknown>
  private failed = false

  private response(value: unknown, opening: boolean): Record<string, unknown> {
    const response = record(value)
    if (response.error != null || response.incomplete_details != null) fail('failure')
    if (response.model !== undefined && response.model !== 'gpt-6-astra') fail('model')
    if (response.id !== undefined) {
      const next = id(response.id)
      if (this.responseId !== undefined && next !== this.responseId) fail('response')
      this.responseId = next
    }
    if (opening) {
      id(response.id)
      if (
        typeof response.status !== 'string' ||
        !['queued', 'in_progress'].includes(response.status)
      )
        fail('response')
      this.lifecycle = true
      // Opening snapshots must not hide output that the collector never observes.
      if (
        response.output !== undefined &&
        (!Array.isArray(response.output) || response.output.length)
      )
        fail('response')
    } else if (response.status !== undefined && response.status !== 'completed') fail('failure')
    return response
  }

  private bind(index: unknown, identity: unknown, type: unknown): Slot {
    if (!Number.isSafeInteger(index) || Number(index) < 0 || Number(index) >= 128) fail('identity')
    const key = id(identity)
    if (typeof type !== 'string' || !TYPES.includes(type)) fail('snapshot')
    const n = Number(index)
    const prior = this.slots.get(n)
    if (prior && (prior.id !== key || prior.type !== type)) fail('identity')
    if (this.positions.has(key) && this.positions.get(key) !== n) fail('identity')
    if (prior) return prior
    const slot = { id: key, type, added: false }
    this.slots.set(n, slot)
    this.positions.set(key, n)
    if ([...this.slots.values()].filter((s) => s.type === 'image_generation_call').length > 4)
      fail('limit')
    return slot
  }

  private snapshot(item: Record<string, unknown>, strict: boolean): void {
    if (item.error != null || item.incomplete_details != null) fail('failure')
    if (item.refusal != null) fail('refusal')
    if (typeof item.type !== 'string' || !TYPES.includes(item.type)) fail('snapshot')
    if (strict || item.id !== undefined) id(item.id)
    if (item.type === 'image_generation_call') {
      if ((strict || item.status !== undefined) && item.status !== 'completed') fail('snapshot')
      if (item.model !== undefined && item.model !== 'gpt-image-2') fail('model')
      if (item.output_format !== undefined && item.output_format !== 'png') fail('snapshot')
      if (typeof item.result !== 'string' || !item.result) fail('snapshot')
    } else if (item.type === 'message') {
      if (item.status !== 'completed' || item.role !== 'assistant' || !Array.isArray(item.content))
        fail('snapshot')
      for (const raw of item.content) {
        const part = record(raw)
        if (part.type === 'refusal' || part.refusal != null) fail('refusal')
        if (part.type !== 'output_text' || typeof part.text !== 'string') fail('snapshot')
        // Image-only research has no admitted citation/annotation capability.
        if (
          part.annotations !== undefined &&
          (!Array.isArray(part.annotations) || part.annotations.length)
        )
          fail('snapshot')
      }
    } else {
      if (item.status !== undefined && item.status !== 'completed') fail('snapshot')
      if (!Array.isArray(item.summary)) fail('snapshot')
      for (const raw of item.summary) {
        const part = record(raw)
        if (part.type !== 'summary_text' || typeof part.text !== 'string' || part.refusal != null)
          fail('snapshot')
      }
      if (item.content !== undefined) {
        if (!Array.isArray(item.content)) fail('snapshot')
        for (const raw of item.content) {
          const part = record(raw)
          if (
            part.type !== 'reasoning_text' ||
            typeof part.text !== 'string' ||
            part.refusal != null
          )
            fail('snapshot')
        }
      }
      if (item.encrypted_content !== undefined && typeof item.encrypted_content !== 'string')
        fail('snapshot')
    }
  }

  observe(value: unknown): void {
    if (this.failed) fail('failure')
    try {
      this.observeEvent(value)
    } catch (error) {
      this.failed = true
      throw error
    }
  }

  private observeEvent(value: unknown): void {
    if (++this.events > 512) fail('limit')
    if (this.terminal) fail('terminal')
    const event = record(value)
    if (event.sequence_number !== undefined) {
      if (
        !Number.isSafeInteger(event.sequence_number) ||
        Number(event.sequence_number) <= this.sequence
      )
        fail('sequence')
      this.sequence = Number(event.sequence_number)
    }
    if (event.response_id !== undefined) {
      const next = id(event.response_id)
      if (this.responseId !== undefined && next !== this.responseId) fail('response')
      this.responseId = next
    }
    if (typeof event.type !== 'string') fail('event')
    const type = event.type
    if (
      event.error != null ||
      ['error', 'response.failed', 'response.incomplete', 'response.cancelled'].includes(type)
    )
      fail('failure')
    if (type.startsWith('response.refusal.') || event.refusal != null) fail('refusal')
    if (['response.created', 'response.in_progress', 'response.completed'].includes(type)) {
      if ('item' in event || 'item_id' in event || 'output_index' in event) fail('event')
      const terminal = type === 'response.completed'
      const response = this.response(event.response, !terminal)
      if (terminal) this.terminal = structuredClone(response)
      return
    }
    if ('response' in event) fail('event')
    if (type === 'response.output_item.added' || type === 'response.output_item.done') {
      const item = record(event.item)
      const slot = this.bind(event.output_index, item.id, item.type)
      if (event.item_id !== undefined && event.item_id !== slot.id) fail('identity')
      if (slot.done) fail('conflict')
      if (item.error != null || item.incomplete_details != null) fail('failure')
      if (item.refusal != null) fail('refusal')
      if (
        item.type === 'image_generation_call' &&
        item.model !== undefined &&
        item.model !== 'gpt-image-2'
      )
        fail('model')
      if (type === 'response.output_item.added') {
        if (slot.added) fail('conflict')
        if (
          item.status !== undefined &&
          (typeof item.status !== 'string' ||
            !['queued', 'in_progress', 'generating', 'completed'].includes(item.status))
        )
          fail('snapshot')
        // Added content cannot smuggle refusals into an otherwise clean done snapshot.
        if (item.content !== undefined && (!Array.isArray(item.content) || item.content.length))
          fail('snapshot')
        if (item.summary !== undefined && (!Array.isArray(item.summary) || item.summary.length))
          fail('snapshot')
        if (item.result != null && item.result !== '') fail('snapshot')
        slot.added = true
      } else {
        this.snapshot(item, true)
        slot.done = structuredClone(item)
      }
      return
    }
    const kind = PROGRESS.has(type)
      ? 'image_generation_call'
      : MESSAGE.has(type)
        ? 'message'
        : REASONING.has(type)
          ? 'reasoning'
          : undefined
    if (!kind || 'item' in event) fail('event')
    const slot = this.bind(event.output_index, event.item_id, kind)
    if (slot.done) fail('conflict')
    if (event.part !== undefined) {
      const part = record(event.part)
      if (part.type === 'refusal' || part.refusal != null) fail('refusal')
      if (
        part.annotations !== undefined &&
        (!Array.isArray(part.annotations) || part.annotations.length)
      )
        fail('snapshot')
      if (
        part.type !== (kind === 'message' ? 'output_text' : 'summary_text') ||
        typeof part.text !== 'string'
      )
        fail('snapshot')
    }
    // Deliberately do not store partial_image_b64 or textual deltas.
  }

  resolve(): { output: Record<string, unknown>[]; outputSource: 'terminal' | 'completed_stream' } {
    if (this.failed) fail('failure')
    const terminal = this.terminal
    if (!terminal) fail('terminal')
    const raw = terminal.output
    if (raw !== undefined && !Array.isArray(raw)) fail('snapshot')
    const recovery = raw === undefined || (Array.isArray(raw) && raw.length === 0)
    let output: Record<string, unknown>[]
    if (recovery) {
      if (!this.lifecycle || terminal.status !== 'completed' || id(terminal.id) !== this.responseId)
        fail('response')
      output = []
      for (let index = 0; index < this.slots.size; index++) {
        const item = this.slots.get(index)?.done
        if (!item) fail('incomplete')
        output.push(item)
      }
    } else {
      const array = raw as unknown[]
      if (array.length > 128) fail('limit')
      output = array.map(record)
      const seen = new Set<string>()
      for (let index = 0; index < output.length; index++) {
        const item = output[index]!
        const slot = this.slots.get(index)
        this.snapshot(item, !!slot)
        if (item.id !== undefined) {
          const key = id(item.id)
          if (seen.has(key) || (this.positions.has(key) && this.positions.get(key) !== index))
            fail('identity')
          seen.add(key)
        }
        if (slot && (slot.id !== item.id || slot.type !== item.type)) fail('identity')
        // Exact completed snapshot agreement; added snapshots are allowed to evolve.
        if (slot?.done && !isDeepStrictEqual(slot.done, item)) fail('conflict')
      }
      for (const index of this.slots.keys()) if (index >= output.length) fail('incomplete')
    }
    const images = output.filter((item) => item.type === 'image_generation_call')
    if (!images.length) fail('no_images')
    if (images.length > 4) fail('limit')
    return {
      output: structuredClone(output),
      outputSource: recovery ? 'completed_stream' : 'terminal',
    }
  }
}
