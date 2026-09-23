import { createHash } from 'node:crypto'
import type { ImageGenerationInput, ImageGenerationOutput } from '@bazilion/api-types'
import { createImagesModels, type ImagesModels } from '@earendil-works/pi-ai'
import { openrouterImagesProvider } from '@earendil-works/pi-ai/providers/openrouter-images'
import type { BazilionDb } from '../core/db/client.ts'
import { imageGenerationConfig } from '../core/image-generation-config.ts'
import * as operations from '../core/repos/image-generations.ts'
import { listEnabled } from '../core/repos/providerState.ts'
import * as results from '../core/repos/results.ts'
import type { ImageGenerationHost } from '../runtime/worker/ipc-protocol.ts'

import {
  boundedImageFetch,
  type GeneratedImages,
  generateOpenAIImages,
  imageAbortable,
} from './image-transport.ts'

export { boundedImageFetch, IMAGE_RESPONSE_BYTES } from './image-transport.ts'
export const IMAGE_DEADLINE_MS = 180_000
const busyHomes = new WeakSet<BazilionDb>()
class ImageGenerationError extends Error {}

export function imageCatalogue(): ImagesModels {
  const models = createImagesModels({
    authContext: { env: async () => undefined, fileExists: async () => false },
  })
  models.setProvider(openrouterImagesProvider())
  return models
}

function validateInput(input: ImageGenerationInput): void {
  if (
    !input ||
    Object.keys(input).some(
      (key) => !['sessionId', 'toolCallId', 'prompt', 'name'].includes(key),
    ) ||
    typeof input.sessionId !== 'string' ||
    typeof input.toolCallId !== 'string' ||
    typeof input.prompt !== 'string' ||
    !input.prompt.trim() ||
    Buffer.byteLength(input.prompt) > 8192
  ) {
    throw new Error('image_generate requires a text prompt of at most 8 KiB and a valid source')
  }
  if (
    input.name !== undefined &&
    (typeof input.name !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,119}$/.test(input.name) ||
      /[ .]$/.test(input.name) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:[ .]|$)/i.test(input.name))
  ) {
    throw new Error('Image name must be a safe display filename (maximum 120 characters)')
  }
}

function decodeImages(response: GeneratedImages, name: string) {
  const images = response.output.filter((part) => part.type === 'image')
  if (images.length === 0 || images.length > 4) {
    throw new ImageGenerationError(
      'Image provider returned no images or exceeded the four-image limit',
    )
  }
  return images.map((image, index) => {
    if (
      image.data.length > Math.ceil(results.MAX_RESULT_BYTES / 3) * 4 ||
      image.data.length % 4 !== 0
    ) {
      throw new Error('Invalid or oversized image bytes')
    }
    const bytes = Buffer.from(image.data, 'base64')
    if (
      !bytes.length ||
      bytes.length > results.MAX_RESULT_BYTES ||
      bytes.toString('base64') !== image.data
    ) {
      throw new Error('Invalid or oversized image bytes')
    }
    const extension =
      image.mimeType === 'image/png' &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? 'png'
        : image.mimeType === 'image/jpeg' &&
            bytes[0] === 255 &&
            bytes[1] === 216 &&
            bytes[2] === 255
          ? 'jpg'
          : image.mimeType === 'image/webp' &&
              bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
              bytes.subarray(8, 12).toString('ascii') === 'WEBP'
            ? 'webp'
            : null
    if (!extension)
      throw new ImageGenerationError(
        'Image content does not match a supported PNG, JPEG or WebP type',
      )
    const stem = name.replace(/\.(png|jpe?g|webp)$/i, '')
    return {
      bytes,
      mimeType: image.mimeType,
      name: `${stem}${images.length > 1 ? `-${index + 1}` : ''}.${extension}`,
    }
  })
}

/** Store only numeric usage. Pi's calculated prices are estimates, not an invoice or spend cap. */
function safeUsage(usage: GeneratedImages['usage']): string | null {
  if (!usage) return null
  const counts = Object.fromEntries(
    ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'].map((key) => {
      const value = usage[key as keyof typeof usage]
      return [key, typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null]
    }),
  )
  const estimate = usage.cost?.total
  return JSON.stringify({
    ...counts,
    estimatedCost:
      typeof estimate === 'number' && Number.isFinite(estimate) && estimate >= 0 ? estimate : null,
  })
}

export interface ImageHostOptions {
  db: BazilionDb
  agentId: string
  teamId: string
  turnId: string
  chatModel?: string
  signal: AbortSignal
  env: () => NodeJS.ProcessEnv
  /** Daemon-owned credential storage/refresh; never accepted from a worker. */
  codex?: { connected: () => boolean; accessToken: () => Promise<string> }
  assertActive: () => void
  source: (sessionId: string, toolCallId: string) => Record<string, unknown>
  /** Internal test injection; never accepted over IPC/config. */
  models?: ImagesModels
  fetch?: typeof fetch
  deadlineMs?: number
}

export function createImageGenerationHost(opts: ImageHostOptions): ImageGenerationHost {
  const { db } = opts
  const models = opts.models ?? imageCatalogue()
  const resolveConfig = () =>
    imageGenerationConfig(opts.env(), opts.codex?.connected(), {
      enabledProviders: listEnabled(db),
      chatModel: opts.chatModel,
    })
  const assertActive = () => {
    opts.signal.throwIfAborted()
    opts.assertActive()
    const owner = db.raw
      .query<{ team_id: string; status: string }, [string]>(
        'SELECT team_id, status FROM agents WHERE id = ?',
      )
      .get(opts.agentId)
    if (owner?.team_id !== opts.teamId || owner.status === 'archived') {
      throw new Error('Image generation Agent is no longer active in this Team')
    }
  }
  const capturedOutput = (op: operations.ImageOperation): ImageGenerationOutput => {
    const ids = operations.resultIds(db, op)
    if (!ids.length)
      throw new Error(
        'Generated results are unavailable; they will not be regenerated automatically',
      )
    return {
      model: op.model,
      files: ids.map((id) => {
        const receipt = results.getReceipt(db, id)
        if (!receipt || receipt.deletedAt !== null)
          throw new Error('Generated result was deleted; it will not be regenerated')
        return {
          name: receipt.name,
          mimeType: receipt.mimeType,
          data: results.readCaptured(db, id).toString('base64'),
          result: { resultId: id },
        }
      }),
    }
  }
  return {
    async generate(input) {
      validateInput(input)
      assertActive()
      const source = opts.source(input.sessionId, input.toolCallId)
      if (
        source.prompt !== input.prompt ||
        source.name !== input.name ||
        Object.keys(source).some((key) => !['prompt', 'name'].includes(key))
      ) {
        throw new Error('Image request does not match the canonical tool call')
      }
      const config = resolveConfig()
      if (!config.ready) throw new Error(config.status)
      const model =
        config.provider === 'openrouter' ? models.getModel('openrouter', config.model) : undefined
      if (
        config.provider === 'openrouter' &&
        (model?.provider !== 'openrouter' ||
          model.api !== 'openrouter-images' ||
          model.baseUrl !== 'https://openrouter.ai/api/v1' ||
          !model.output.includes('image'))
      ) {
        throw new Error('Selected Pi image model is unavailable; no fallback was attempted')
      }
      if (busyHomes.has(db))
        throw new Error('Image generation is busy; only one request per home may be in flight')
      const op: operations.ImageOperation = {
        agentId: opts.agentId,
        teamId: opts.teamId,
        turnId: opts.turnId,
        sessionId: input.sessionId,
        toolCallId: input.toolCallId,
        model: config.model,
        requestSha256: createHash('sha256')
          .update(JSON.stringify([input.prompt, input.name ?? null]))
          .digest('hex'),
      }
      if (operations.admit(db, op) === 'completed') return capturedOutput(op)
      busyHomes.add(db)
      const deadline = new AbortController()
      const timer = setTimeout(() => deadline.abort(), opts.deadlineMs ?? IMAGE_DEADLINE_MS)
      const signal = AbortSignal.any([opts.signal, deadline.signal])
      try {
        let apiKey = config.apiKey
        if (config.provider === 'openai-codex') {
          try {
            if (!opts.codex) throw new Error('Missing login')
            apiKey = await imageAbortable(opts.codex.accessToken(), signal)
          } catch {
            throw new ImageGenerationError(
              'ChatGPT credentials unavailable. Reconnect ChatGPT on /config or run bazilion auth openai login. No API-key fallback or automatic retry.',
            )
          }
        }
        signal.throwIfAborted()
        assertActive()
        const current = resolveConfig()
        if (!current.ready || current.model !== config.model) {
          throw new ImageGenerationError(
            'Image configuration changed before dispatch. No image request was sent; inspect settings before starting a new turn. No billing-route fallback.',
          )
        }
        if (!apiKey) throw new Error('Missing image credential')
        let pending: Promise<GeneratedImages>
        if (config.provider === 'openrouter') {
          if (!model) throw new Error('Selected Pi image model unavailable')
          pending = models.generateImages(
            model,
            { input: [{ type: 'text', text: input.prompt }] },
            {
              apiKey,
              signal,
              timeoutMs: opts.deadlineMs ?? IMAGE_DEADLINE_MS,
              maxRetries: 0,
              fetch: boundedImageFetch(opts.fetch),
            },
          )
        } else {
          pending = generateOpenAIImages({
            provider: config.provider,
            apiKey,
            prompt: input.prompt,
            signal,
            fetch: opts.fetch,
          })
        }
        const response = await imageAbortable(pending, signal)
        signal.throwIfAborted()
        assertActive()
        if (response.stopReason !== 'stop') {
          // Never surface provider-controlled errors, echoed prompts or credentials in tool output.
          throw new ImageGenerationError(
            'Image provider failed or refused the request. Check OpenRouter access/quota; billing may have occurred. No automatic retry.',
          )
        }
        const images = decodeImages(response, input.name ?? 'generated-image')
        const responseId =
          typeof response.responseId === 'string' &&
          /^[A-Za-z0-9._:-]{1,256}$/.test(response.responseId) &&
          !response.responseId.includes(apiKey)
            ? response.responseId
            : null
        db.raw.transaction(() => {
          images.forEach((image, sourceIndex) => {
            results.publish(db, {
              teamId: opts.teamId,
              agentId: opts.agentId,
              sessionId: input.sessionId,
              toolCallId: input.toolCallId,
              sourceIndex,
              imageModel: config.model,
              ...image,
            })
          })
          operations.settle(db, op, 'completed', responseId, safeUsage(response.usage))
        })()
        return capturedOutput(op)
      } catch (error) {
        // Admission stays uncertain on transport, cancellation or storage failure. Never replay it.
        if (signal.aborted)
          throw new Error(
            'Image generation cancelled or timed out; billing or account usage may have occurred. No automatic retry.',
          )
        // Only our own bounded messages escape; unexpected SDK exceptions may carry secrets.
        if (error instanceof ImageGenerationError) {
          throw error
        }
        throw new Error(
          'Image generation failed; billing or account usage may have occurred. No automatic retry or credential fallback. Check account access/quota (reconnect ChatGPT if selected), configuration and saved Results.',
        )
      } finally {
        clearTimeout(timer)
        busyHomes.delete(db)
      }
    },
  }
}
