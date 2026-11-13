import { createModels } from '@earendil-works/pi-ai'
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter'
import type { BazilionDb } from '../core/db/client.ts'
import { type ImageRoute, imageRoute } from '../core/image-generation-config.ts'
import * as results from '../core/repos/results.ts'
import type { ImageGenerationHost, ImageGenerationInput } from '../runtime/worker/ipc-protocol.ts'
import {
  assertOk,
  CODEX_RESPONSES_URL,
  codexHeaders,
  readCapped,
  responsesStream,
} from './openai-responses.ts'

// image_generate: the daemon calls the selected image model and saves each image as a result.

const MAX_CALLS_PER_TURN = 4
const DEADLINE_MS = 180_000
const MAX_RESPONSE_BYTES = 40 * 1024 * 1024
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,119}$/

/** Pi reads OpenRouter's response itself: fail the read once it passes 40 MiB. */
function cappedFetch(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await fetchImpl(input, init)
    if (!response.body) return response
    let size = 0
    const body = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          size += chunk.byteLength
          if (size > MAX_RESPONSE_BYTES)
            controller.error(new Error('The image response is larger than 40 MiB'))
          else controller.enqueue(chunk)
        },
      }),
    )
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }
}

export interface ImageHostOptions {
  db: BazilionDb
  agentId: string
  teamId: string
  /** The turn's conversation; saved images are delivered in it. */
  conversationId: string
  signal: AbortSignal
  env: () => NodeJS.ProcessEnv
  codex: { connected: () => boolean; accessToken: () => Promise<string> }
  /** Tests replace the network. */
  fetch?: typeof fetch
}

type Ready = Extract<ImageRoute, { ready: true }>

/** The base64 images the provider returned. */
async function requestImages(
  route: Ready,
  prompt: string,
  signal: AbortSignal,
  opts: ImageHostOptions,
): Promise<string[]> {
  const fetchImpl = opts.fetch ?? fetch
  if (route.provider === 'openai-codex') {
    // The ChatGPT backend generates images as a tool of a chat model.
    const output = await responsesStream(
      CODEX_RESPONSES_URL,
      codexHeaders(await opts.codex.accessToken()),
      {
        model: 'gpt-6-astra',
        instructions: 'Generate the requested image using the image generation tool.',
        input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
        tools: [
          {
            type: 'image_generation',
            model: route.modelId,
            size: '1024x1024',
            output_format: 'png',
          },
        ],
        tool_choice: { type: 'image_generation' },
      },
      signal,
      fetchImpl,
    )
    return output.flatMap((item) =>
      item.type === 'image_generation_call' && typeof item.result === 'string' ? [item.result] : [],
    )
  }
  if (route.provider === 'openai') {
    const response = await fetchImpl('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { authorization: `Bearer ${route.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: route.modelId,
        prompt,
        n: 1,
        size: '1024x1024',
        output_format: 'png',
      }),
      signal,
      redirect: 'error',
    })
    await assertOk(response)
    const body = JSON.parse(await readCapped(response)) as { data?: Array<{ b64_json?: unknown }> }
    return (body.data ?? []).flatMap((entry) =>
      typeof entry.b64_json === 'string' ? [entry.b64_json] : [],
    )
  }
  const models = createModels({
    authContext: { env: async () => undefined, fileExists: async () => false },
  })
  models.setProvider(openrouterProvider())
  const model = models.getModelOfType('image', 'openrouter', route.modelId)
  if (!model) throw new Error(`OpenRouter image model ${route.modelId} is not available`)
  const response = await models.generateImages(
    model,
    { input: [{ type: 'text', text: prompt }] },
    { apiKey: route.apiKey, signal, maxRetries: 0, fetch: cappedFetch(fetchImpl) },
  )
  if (response.stopReason !== 'stop')
    throw new Error(response.errorMessage || `OpenRouter stopped: ${response.stopReason}`)
  return response.output.flatMap((part) => (part.type === 'image' ? [part.data] : []))
}

function imageType(bytes: Buffer): { mimeType: string; extension: string } | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return { mimeType: 'image/png', extension: 'png' }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { mimeType: 'image/jpeg', extension: 'jpg' }
  if (
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return { mimeType: 'image/webp', extension: 'webp' }
  return null
}

/** One host per turn: it counts the turn's calls and saves images into the turn's conversation. */
export function createImageGenerationHost(opts: ImageHostOptions): ImageGenerationHost {
  let calls = 0
  return {
    async generate(input: ImageGenerationInput) {
      const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : ''
      if (!prompt || Buffer.byteLength(prompt) > 8192)
        throw new Error('image_generate needs a prompt of at most 8 KiB')
      if (input.name !== undefined && !SAFE_NAME.test(input.name))
        throw new Error(
          'The image name must be a plain file name (letters, digits, space, _ . -; at most 120 characters)',
        )
      if (++calls > MAX_CALLS_PER_TURN)
        throw new Error('Image limit reached: at most four image_generate calls per turn')
      const route = imageRoute(opts.env(), opts.codex.connected())
      if (!route.ready) throw new Error(route.reason)
      const signal = AbortSignal.any([opts.signal, AbortSignal.timeout(DEADLINE_MS)])
      const images = (await requestImages(route, prompt, signal, opts)).slice(0, 4)
      if (!images.length) throw new Error(`${route.model} returned no image`)
      const decoded = images.map((data) => {
        const bytes = Buffer.from(data, 'base64')
        const type = imageType(bytes)
        if (!type)
          throw new Error(`${route.model} returned data that is not a PNG, JPEG or WebP image`)
        return { bytes, ...type }
      })
      const stem = (input.name ?? 'generated-image').replace(/\.(png|jpe?g|webp)$/i, '')
      // All images of the call are saved, or none (e.g. when the result store is full).
      const files = opts.db.raw.transaction(() =>
        decoded.map((image, index) => {
          const saved = results.publish(opts.db, {
            teamId: opts.teamId,
            agentId: opts.agentId,
            sessionId: opts.conversationId,
            toolCallId: input.toolCallId,
            sourceIndex: index,
            imageModel: route.model,
            name: `${stem}${decoded.length > 1 ? `-${index + 1}` : ''}.${image.extension}`,
            mimeType: image.mimeType,
            bytes: image.bytes,
          })
          return { name: saved.name, mimeType: saved.mimeType, result: { resultId: saved.id } }
        }),
      )()
      return { model: route.model, files }
    },
  }
}
