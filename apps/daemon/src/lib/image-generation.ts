import { createModels } from '@earendil-works/pi-ai'
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter'
import type { BazilionDb } from '../core/db/client.ts'
import { type ImageRoute, imageRoute } from '../core/image-generation-config.ts'
import * as results from '../core/repos/results.ts'
import { MAX_PICTURE_BYTES, pictureType } from '../runtime/tools/pictures.ts'
import type {
  ImageGenerationHost,
  ImageGenerationInput,
  ImageGenerationOutput,
} from '../runtime/worker/ipc-protocol.ts'
import {
  assertOk,
  CODEX_RESPONSES_URL,
  codexHeaders,
  readCapped,
  responsesStream,
} from './openai-responses.ts'
import { queueWake } from './wakes.ts'

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
  /**
   * The bytes of a picture the Agent names as a reference (a path in its workspace or uploads, as
   * it sees them); throws when the path is not one it may read.
   */
  readReference?: (path: string) => Buffer
  /** Tests replace the network. */
  fetch?: typeof fetch
}

/** A picture to start from, checked to be an image the models take. */
interface Reference {
  bytes: Buffer
  mimeType: string
  name: string
}

type Ready = Extract<ImageRoute, { ready: true }>

/** The base64 images the provider returned. */
async function requestImages(
  route: Ready,
  prompt: string,
  references: readonly Reference[],
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
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              ...references.map((reference) => ({
                type: 'input_image',
                image_url: `data:${reference.mimeType};base64,${reference.bytes.toString('base64')}`,
              })),
            ],
          },
        ],
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
  if (route.provider === 'openai' && references.length > 0) {
    // Pictures to start from go to the edits endpoint, as files.
    const form = new FormData()
    form.append('model', route.modelId)
    form.append('prompt', prompt)
    form.append('n', '1')
    form.append('size', '1024x1024')
    form.append('output_format', 'png')
    for (const reference of references) {
      form.append(
        'image[]',
        new Blob([new Uint8Array(reference.bytes)], { type: reference.mimeType }),
        reference.name,
      )
    }
    const response = await fetchImpl('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { authorization: `Bearer ${route.apiKey}` },
      body: form,
      signal,
      redirect: 'error',
    })
    await assertOk(response)
    const body = JSON.parse(await readCapped(response)) as { data?: Array<{ b64_json?: unknown }> }
    return (body.data ?? []).flatMap((entry) =>
      typeof entry.b64_json === 'string' ? [entry.b64_json] : [],
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
    {
      input: [
        { type: 'text', text: prompt },
        ...references.map((reference) => ({
          type: 'image' as const,
          data: reference.bytes.toString('base64'),
          mimeType: reference.mimeType,
        })),
      ],
    },
    { apiKey: route.apiKey, signal, maxRetries: 0, fetch: cappedFetch(fetchImpl) },
  )
  if (response.stopReason !== 'stop')
    throw new Error(response.errorMessage || `OpenRouter stopped: ${response.stopReason}`)
  return response.output.flatMap((part) => (part.type === 'image' ? [part.data] : []))
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
      const references = (input.references ?? []).map((path) => readReference(opts, path))
      if (++calls > MAX_CALLS_PER_TURN)
        throw new Error('Image limit reached: at most four image_generate calls per turn')
      const route = imageRoute(opts.env(), opts.codex.connected())
      if (!route.ready) throw new Error(route.reason)
      if (!input.background) {
        const signal = AbortSignal.any([opts.signal, AbortSignal.timeout(DEADLINE_MS)])
        return generateAndSave(route, prompt, references, input, signal, opts)
      }
      // In the background: the turn goes on, and the end of the turn does not stop it.
      void generateAndSave(
        route,
        prompt,
        references,
        input,
        AbortSignal.timeout(DEADLINE_MS),
        opts,
      ).then(
        (output) =>
          queueWake({
            id: `image:${input.toolCallId}`,
            agentId: opts.agentId,
            conversationId: opts.conversationId,
            summary: 'A picture you asked for is ready',
            text: [
              `The picture is saved: ${output.files.map((file) => `"${file.name}" as result ${file.result.resultId}`).join(', ')}.`,
              `Show it to the user with deliver_file and result set to ${output.files.map((file) => file.result.resultId).join(', then ')}, and say what it is.`,
            ].join('\n\n'),
            at: Date.now(),
          }),
        (error: unknown) =>
          queueWake({
            id: `image:${input.toolCallId}`,
            agentId: opts.agentId,
            conversationId: opts.conversationId,
            summary: 'A picture you asked for could not be made',
            text: `${route.model} failed: ${error instanceof Error ? error.message : String(error)}. Tell the user, and try again only if it is worth it.`,
            at: Date.now(),
          }),
      )
      return { model: route.model, files: [], pending: true }
    },
  }
}

function readReference(opts: ImageHostOptions, path: string): Reference {
  if (typeof path !== 'string' || !path) throw new Error('A reference is a path to a picture')
  if (!opts.readReference) throw new Error('This turn cannot read reference pictures')
  const bytes = opts.readReference(path)
  if (bytes.length > MAX_PICTURE_BYTES) throw new Error(`${path} is larger than 25 MiB`)
  const type = pictureType(bytes)
  // The image models take these three; a GIF is not one of them.
  if (!type || type.mimeType === 'image/gif')
    throw new Error(`${path} is not a PNG, JPEG or WebP picture`)
  return { bytes, mimeType: type.mimeType, name: `reference.${type.extension}` }
}

async function generateAndSave(
  route: Ready,
  prompt: string,
  references: readonly Reference[],
  input: ImageGenerationInput,
  signal: AbortSignal,
  opts: ImageHostOptions,
): Promise<ImageGenerationOutput> {
  const images = (await requestImages(route, prompt, references, signal, opts)).slice(0, 4)
  if (!images.length) throw new Error(`${route.model} returned no image`)
  const decoded = images.map((data) => {
    const bytes = Buffer.from(data, 'base64')
    const type = pictureType(bytes)
    if (!type || type.mimeType === 'image/gif')
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
}
