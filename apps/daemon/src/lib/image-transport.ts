import type { AssistantImages } from '@earendil-works/pi-ai'
import type { ImageProvider } from '../core/image-generation-config.ts'

export const IMAGE_RESPONSE_BYTES = 40 * 1024 * 1024
const endpoints = {
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  openai: 'https://api.openai.com/v1/images/generations',
  'openai-codex': 'https://chatgpt.com/backend-api/codex/responses',
} as const

export interface GeneratedImages {
  output: AssistantImages['output']
  stopReason: AssistantImages['stopReason']
  responseId?: string
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
    if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream'))
      throw new Error('Expected image event stream')
    return readCodexImages(await response.text())
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
  if (typeof id !== 'string' || !id || id.length > 256 || seen.has(id))
    throw new Error('Invalid or duplicate image identity')
  seen.add(id)
}

function readCodexImages(body: string): GeneratedImages {
  let completed: Record<string, unknown> | undefined
  const done: Record<string, unknown>[] = []
  const doneIds = new Set<string>()
  let count = 0
  for (const frame of body.replace(/\r\n?/g, '\n').split('\n\n')) {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n')
      .trim()
    if (!data || data === '[DONE]') continue
    if (++count > 512) throw new Error('Too many image stream events')
    const event = object(JSON.parse(data))
    if (['error', 'response.failed', 'response.incomplete'].includes(String(event.type)))
      throw new Error('Image stream failed or was incomplete')
    if (event.type === 'response.completed') {
      if (completed) throw new Error('Duplicate image completion')
      completed = object(event.response)
      if (completed.error != null || (completed.status != null && completed.status !== 'completed'))
        throw new Error('Image response was not completed')
    }
    if (event.type === 'response.output_item.done') {
      const item = object(event.item)
      if (item.type !== 'image_generation_call') continue
      checkImageId(item.id, doneIds)
      done.push(item)
      if (done.length > 4) throw new Error('Too many images')
    }
  }
  if (!completed) throw new Error('Image stream closed before completion')
  // An explicit final output (even empty/refused) wins; only omitted output may use done events.
  const output = completed.output === undefined ? done : completed.output
  if (!Array.isArray(output)) throw new Error('Malformed image output')
  const items = output.map(object).filter((item) => item.type === 'image_generation_call')
  if (items.length < 1 || items.length > 4) throw new Error('Missing or excessive image output')
  const ids = new Set<string>()
  const images = items.map((item) => {
    checkImageId(item.id, ids)
    // Some completed streams omit per-item status/id; the mandatory terminal event owns completion.
    if (item.status != null && item.status !== 'completed')
      throw new Error('Image call did not complete')
    return image(item.result)
  })
  return {
    stopReason: 'stop',
    output: images,
    responseId: responseId(completed.id),
    usage: usage(completed.usage),
  }
}
