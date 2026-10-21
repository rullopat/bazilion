import type { AssistantImages } from '@earendil-works/pi-ai'
import type { ImageProvider } from '../core/image-generation-config.ts'
import { CompletedImageEvidence, ImageEvidenceError } from './image-evidence.ts'

export const IMAGE_RESPONSE_BYTES = 40 * 1024 * 1024

// Every refusal code is authored locally. Never classify or expose upstream error text.
const IMAGE_REFUSAL_CODES = [
  'unsupported_media',
  'decode_failed',
  'unterminated_event',
  'too_many_events',
  'invalid_framing',
  'duplicate_label',
  'label_without_data',
  'done_out_of_order',
  'malformed_event',
  'invalid_event_type_or_label',
  'event_after_done',
  'duplicate_completion',
  'done_alias_after_completion',
  'item_after_completion',
  'failure_after_completion',
  'other_event_after_completion',
  'provider_failure',
  'malformed_terminal',
  'terminal_error',
  'terminal_incomplete',
  'terminal_status',
  'malformed_done_item',
  'invalid_image_identity',
  'duplicate_image_identity',
  'too_many_done_images',
  'missing_completion',
  'malformed_output',
  'terminal_output_empty',
  'no_image_items',
  'too_many_image_items',
  'malformed_output_item',
  'image_status',
  'missing_image_bytes',
  'internal_failure',
  'evidence_event',
  'evidence_sequence',
  'evidence_response',
  'evidence_model',
  'evidence_failure',
  'evidence_identity',
  'evidence_snapshot',
  'evidence_refusal',
  'evidence_limit',
  'evidence_terminal',
  'evidence_conflict',
  'evidence_incomplete',
  'evidence_no_images',
] as const
type ImageRefusalCode = (typeof IMAGE_REFUSAL_CODES)[number]
class ImageEvidenceRefusal extends Error {
  constructor(readonly code: ImageRefusalCode) {
    super('Image evidence refused')
  }
}
function refuse(code: ImageRefusalCode): never {
  throw new ImageEvidenceRefusal(code)
}
function codexObject(value: unknown, code: ImageRefusalCode): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) refuse(code)
  return value as Record<string, unknown>
}

/** Closed image-protocol facts only; never upstream text, headers, ids or exceptions. */
export class ImageProtocolFailure extends Error {
  constructor(
    phase: 'media' | 'decode' | 'evidence',
    media: 'missing' | 'sse' | 'other',
    terminal: 'unseen' | 'completed' = 'unseen',
    reason: ImageRefusalCode = 'unsupported_media',
  ) {
    // This exported boundary is also callable from JavaScript. Do not rely on TS unions
    // to prevent arbitrary strings or coercion hooks from reaching the operator.
    const safePhase = phase === 'media' || phase === 'decode' ? phase : 'evidence'
    const safeMedia = media === 'missing' || media === 'sse' ? media : 'other'
    const safeTerminal = terminal === 'completed' ? terminal : 'unseen'
    const safeReason = IMAGE_REFUSAL_CODES.includes(reason) ? reason : 'internal_failure'
    super(
      `Image protocol refused [phase=${safePhase}; media=${safeMedia}; terminal=${safeTerminal}] [reason=${safeReason}]. Billing or account usage may have occurred. No automatic retry or credential fallback.`,
    )
  }
}
const endpoints = {
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  openai: 'https://api.openai.com/v1/images/generations',
  'openai-codex': 'https://chatgpt.com/backend-api/codex/responses',
} as const

export interface GeneratedImages {
  output: AssistantImages['output']
  stopReason: AssistantImages['stopReason']
  responseId?: string
  outputSource?: 'terminal' | 'completed_stream'
  usage?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
    totalTokens?: number
    cost?: { total?: number }
  }
}

/** One fixed destination per credential route; cap decoded bytes before JSON/SSE parsing. */
export function boundedImageFetch(
  fetcher: typeof fetch = fetch,
  provider: ImageProvider = 'openrouter',
): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.href !== endpoints[provider]) throw new Error('Unexpected image provider endpoint')
    const response = await fetcher(input, { ...init, redirect: 'error' })
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Image provider returned no response body')
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      if (Number(response.headers.get('content-length')) > IMAGE_RESPONSE_BYTES)
        throw new Error('Image response exceeds the byte limit')
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > IMAGE_RESPONSE_BYTES) throw new Error('Image response exceeds the byte limit')
        chunks.push(value)
      }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    return new Response(Buffer.concat(chunks), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }
}

/** Bound even an OAuth supplier that cannot cancel a shared daemon refresh flight. */
export async function imageAbortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort = () => {}
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new Error('Image request aborted'))
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
  try {
    return await Promise.race([promise, cancelled])
  } finally {
    signal.removeEventListener('abort', abort)
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Malformed image response')
  return value as Record<string, unknown>
}
function usage(value: unknown): GeneratedImages['usage'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const number = (key: string) =>
    typeof raw[key] === 'number' && Number.isFinite(raw[key]) && raw[key] >= 0
      ? raw[key]
      : undefined
  return {
    input: number('input_tokens'),
    output: number('output_tokens'),
    totalTokens: number('total_tokens'),
  }
}
function responseId(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined // Host bounds and secret-filters before storage.
}
function image(data: unknown): AssistantImages['output'][number] {
  if (typeof data !== 'string' || !data) throw new Error('Missing image bytes')
  // Both requests explicitly select PNG. The shared capture path validates base64 and signature.
  return { type: 'image', mimeType: 'image/png', data }
}

/** Subscription transport is deliberately separate from the public, API-billed Images API.
 * Protocol observed in OpenClaw's Codex image adapter; not a promise of account entitlement.
 * The orchestrator is pinned independently of the Agent's chat model. No tools besides image generation.
 */
export async function generateOpenAIImages(opts: {
  provider: 'openai' | 'openai-codex'
  apiKey: string
  prompt: string
  signal: AbortSignal
  fetch?: typeof fetch
}): Promise<GeneratedImages> {
  const codex = opts.provider === 'openai-codex'
  opts.signal.throwIfAborted()
  const response = await boundedImageFetch(opts.fetch, opts.provider)(endpoints[opts.provider], {
    method: 'POST',
    signal: opts.signal,
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
      Accept: codex ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify(
      codex
        ? {
            model: 'gpt-6-astra',
            instructions: 'Generate the requested image using the image generation tool.',
            input: [{ role: 'user', content: [{ type: 'input_text', text: opts.prompt }] }],
            tools: [
              {
                type: 'image_generation',
                model: 'gpt-image-2',
                size: '1024x1024',
                output_format: 'png',
              },
            ],
            tool_choice: { type: 'image_generation' },
            stream: true,
            store: false,
          }
        : {
            model: 'gpt-image-2',
            prompt: opts.prompt,
            n: 1,
            size: '1024x1024',
            output_format: 'png',
          },
    ),
  })
  // No credential refresh-and-replay on 401, no SDK retries, no fallback route or URL downloads.
  if (!response.ok) throw new Error('Image provider rejected the request')
  if (codex) {
    const header = response.headers.get('content-type')
    const mime = header?.trim().toLowerCase()
    const media = !mime
      ? 'missing'
      : mime.split(';', 1)[0]?.trim() === 'text/event-stream'
        ? 'sse'
        : 'other'
    // The admitted Codex request explicitly sets stream:true / Accept:SSE. Missing or
    // blank MIME follows that contract, never prefix sniffing or decoder-failure fallback.
    if ((header?.length ?? 0) > 256 || media === 'other')
      throw new ImageProtocolFailure('media', 'other')
    return readCodexImages(await response.arrayBuffer(), media)
  }
  const body = object(await response.json())
  if (!Array.isArray(body.data) || body.data.length < 1 || body.data.length > 4)
    throw new Error('Missing or excessive image output')
  return {
    stopReason: 'stop',
    output: body.data.map((entry) => image(object(entry).b64_json)),
    responseId: responseId(body.id),
    usage: usage(body.usage),
  }
}

function checkImageId(id: unknown, seen: Set<string>): void {
  if (id == null) return
  if (typeof id !== 'string' || !id || id.length > 256) refuse('invalid_image_identity')
  if (seen.has(id)) refuse('duplicate_image_identity')
  seen.add(id)
}

function readCodexImages(bytes: ArrayBuffer, media: 'missing' | 'sse'): GeneratedImages {
  let phase: 'decode' | 'evidence' = 'decode'
  let terminal: 'unseen' | 'completed' = 'unseen'
  try {
    const body = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return parseCodexImages(
      body,
      () => {
        phase = 'decode'
      },
      () => {
        phase = 'evidence'
      },
      () => {
        terminal = 'completed'
      },
    )
  } catch (error) {
    const reason =
      error instanceof ImageEvidenceRefusal
        ? error.code
        : error instanceof ImageEvidenceError
          ? (`evidence_${error.code}` as const)
          : phase === 'decode'
            ? 'decode_failed'
            : 'internal_failure'
    throw new ImageProtocolFailure(phase, media, terminal, reason)
  }
}

function parseCodexImages(
  body: string,
  decoding: () => void,
  evidence: () => void,
  completedEvent: () => void,
): GeneratedImages {
  let completed: Record<string, unknown> | undefined
  const collector = new CompletedImageEvidence()
  let doneCount = 0
  const doneIds = new Set<string>()
  let count = 0
  let providerDone = false
  const frames = body.replace(/\r\n?/g, '\n').split('\n\n')
  if (frames.pop()?.trim()) refuse('unterminated_event')
  for (const frame of frames) {
    decoding()
    if (++count > 512) refuse('too_many_events')
    const lines = frame.split('\n')
    if (
      lines.some((line) => line && !line.startsWith(':') && !/^(data|event|id|retry):/.test(line))
    )
      refuse('invalid_framing')
    const labels = lines.filter((line) => line.startsWith('event:'))
    if (labels.length > 1) refuse('duplicate_label')
    const label = labels[0]?.slice(6).trim()
    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n')
    if (!data) {
      if (label) refuse('label_without_data')
      continue
    }
    if (data === '[DONE]') {
      evidence()
      if (label || !completed || providerDone) refuse('done_out_of_order')
      providerDone = true
      continue
    }
    const event = codexObject(JSON.parse(data), 'malformed_event')
    evidence()
    if (typeof event.type !== 'string' || (label && label !== event.type))
      refuse('invalid_event_type_or_label')
    if (providerDone) refuse('event_after_done')
    if (completed) {
      if (event.type === 'response.completed') refuse('duplicate_completion')
      if (event.type === 'response.done') refuse('done_alias_after_completion')
      if (event.type === 'response.output_item.done') refuse('item_after_completion')
      if (
        ['error', 'response.failed', 'response.incomplete', 'response.cancelled'].includes(
          event.type,
        )
      )
        refuse('failure_after_completion')
      refuse('other_event_after_completion')
    }
    if (
      ['error', 'response.failed', 'response.incomplete', 'response.cancelled'].includes(event.type)
    )
      refuse('provider_failure')
    if (event.type === 'response.completed') {
      completed = codexObject(event.response, 'malformed_terminal')
      completedEvent()
      if (completed.error != null) refuse('terminal_error')
      if (completed.incomplete_details != null) refuse('terminal_incomplete')
      if (completed.status != null && completed.status !== 'completed') refuse('terminal_status')
    }
    if (event.type === 'response.output_item.done') {
      const item = codexObject(event.item, 'malformed_done_item')
      if (item.type === 'image_generation_call') {
        checkImageId(item.id, doneIds)
        if (++doneCount > 4) refuse('too_many_done_images')
      }
    }
    // Framing, terminal and full-stream checks remain transport-owned. No early return.
    collector.observe(event)
  }
  evidence()
  if (!completed) refuse('missing_completion')
  if (completed.output !== undefined && !Array.isArray(completed.output)) refuse('malformed_output')
  const project = (output: unknown[]) => {
    const items = output
      .map((value) => codexObject(value, 'malformed_output_item'))
      .filter((item) => item.type === 'image_generation_call')
    if (items.length < 1) refuse('no_image_items')
    if (items.length > 4) refuse('too_many_image_items')
    const ids = new Set<string>()
    return items.map((item) => {
      checkImageId(item.id, ids)
      // Some completed streams omit per-item status/id; the mandatory terminal event owns completion.
      if (item.status != null && item.status !== 'completed') refuse('image_status')
      if (typeof item.result !== 'string' || !item.result) refuse('missing_image_bytes')
      return image(item.result)
    })
  }
  // Preserve precise terminal projection refusals before cross-stream reconciliation.
  if (Array.isArray(completed.output) && completed.output.length) project(completed.output)
  const resolved = collector.resolve()
  return {
    stopReason: 'stop',
    output: project(resolved.output),
    outputSource: resolved.outputSource,
    responseId: responseId(completed.id),
    usage: usage(completed.usage),
  }
}
