// Videos (BAZ-095): one short clip with sound from a prompt, or from a picture as its first frame,
// through the chosen route. xAI and MiniMax run a job and are asked about it until it is done;
// Gemini Omni answers the request itself when the video is made. Endpoints and fields as each
// provider documented them on 2026-11-27.

import type { ChosenRoute, VideoRouteDef } from '../../core/media-routes.ts'
import { type Fetch, mediaType, okBytes, okJson, pause } from './http.ts'

export type VideoShape = 'landscape' | 'portrait' | 'square'

export interface VideoRequest {
  prompt: string
  seconds: number
  shape: VideoShape
  /** The first frame, when the video starts from a picture. */
  image?: { bytes: Buffer; mimeType: string }
}

/** What each route takes, from its provider's documentation: lengths in whole seconds, shapes. */
export const VIDEO_CHOICES: Record<
  VideoRouteDef['id'],
  { seconds: { least: number; most: number }; shapes: readonly VideoShape[] }
> = {
  'xai:grok-imagine-video-1.5': {
    seconds: { least: 1, most: 15 },
    shapes: ['landscape', 'portrait', 'square'],
  },
  'google:gemini-omni-1.2-flash': {
    seconds: { least: 3, most: 15 },
    shapes: ['landscape', 'portrait'],
  },
  'minimax:MiniMax-H3': {
    seconds: { least: 4, most: 15 },
    shapes: ['landscape', 'portrait', 'square'],
  },
}

const RATIO: Record<VideoShape, string> = { landscape: '16:9', portrait: '9:16', square: '1:1' }

/** How often a job is asked about, as each provider suggests. */
const LOOK_EVERY_MS = { xai: 5_000, minimax: 10_000 } as const

type Ready = Extract<ChosenRoute<VideoRouteDef>, { ready: true }>

export interface VideoOptions {
  fetch?: Fetch
  signal?: AbortSignal
  /** Tests shorten the wait between looks at a job. */
  pause?: (ms: number, signal?: AbortSignal) => Promise<void>
}

export interface MadeVideo {
  bytes: Buffer
  mimeType: string
  extension: string
}

/** Check a request against what the route takes; throws with what it does take. */
export function checkVideoRequest(route: VideoRouteDef, request: VideoRequest): void {
  const choices = VIDEO_CHOICES[route.id]
  const { least, most } = choices.seconds
  if (!Number.isInteger(request.seconds) || request.seconds < least || request.seconds > most)
    throw new Error(`${route.model} makes videos of ${least} to ${most} whole seconds`)
  if (!choices.shapes.includes(request.shape))
    throw new Error(`${route.model} makes ${choices.shapes.join(' or ')} videos`)
}

const dataUrl = (image: { bytes: Buffer; mimeType: string }) =>
  `data:${image.mimeType};base64,${image.bytes.toString('base64')}`

function asVideo(bytes: Buffer, model: string): MadeVideo {
  const type = mediaType(bytes)
  if (!type?.mimeType.startsWith('video/')) throw new Error(`${model} returned no video`)
  return { bytes, ...type }
}

export async function generateVideo(
  chosen: Ready,
  request: VideoRequest,
  options: VideoOptions = {},
): Promise<MadeVideo> {
  checkVideoRequest(chosen.route, request)
  const fetchImpl = options.fetch ?? fetch
  const wait = options.pause ?? pause
  const { signal } = options
  const model = chosen.route.model
  switch (chosen.route.provider) {
    case 'xai': {
      const auth = { authorization: `Bearer ${chosen.apiKey}` }
      const started = await okJson<{ request_id?: string }>(
        await fetchImpl('https://api.x.ai/v1/videos/generations', {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: chosen.modelId,
            prompt: request.prompt,
            duration: request.seconds,
            aspect_ratio: RATIO[request.shape],
            resolution: '720p',
            ...(request.image ? { image: { url: dataUrl(request.image) } } : {}),
          }),
          ...(signal ? { signal } : {}),
        }),
        model,
      )
      if (!started.request_id) throw new Error(`${model} started no job`)
      for (;;) {
        await wait(LOOK_EVERY_MS.xai, signal)
        const job = await okJson<{
          status?: string
          video?: { url?: string }
          error?: { message?: string }
        }>(
          await fetchImpl(`https://api.x.ai/v1/videos/${encodeURIComponent(started.request_id)}`, {
            headers: auth,
            ...(signal ? { signal } : {}),
          }),
          model,
        )
        if (job.status === 'failed') throw new Error(job.error?.message || `${model} failed`)
        if (job.status !== 'done') continue
        if (!job.video?.url) throw new Error(`${model} held the video back (moderation)`)
        // A temporary address on xAI's own host: fetched without the key.
        return asVideo(
          await okBytes(await fetchImpl(job.video.url, signal ? { signal } : {}), model),
          model,
        )
      }
    }
    case 'google': {
      const body = await okJson<{
        status?: string
        error?: { message?: string }
        steps?: { type?: string; content?: { type?: string; data?: string; uri?: string }[] }[]
      }>(
        await fetchImpl('https://generativelanguage.googleapis.com/v1beta/interactions', {
          method: 'POST',
          headers: {
            'x-goog-api-key': chosen.apiKey,
            'content-type': 'application/json',
            'api-revision': '2026-05-20',
          },
          body: JSON.stringify({
            model: chosen.modelId,
            input: request.image
              ? [
                  { type: 'text', text: request.prompt },
                  {
                    type: 'image',
                    data: request.image.bytes.toString('base64'),
                    mime_type: request.image.mimeType,
                  },
                ]
              : request.prompt,
            response_format: {
              type: 'video',
              aspect_ratio: RATIO[request.shape],
              resolution: '720p',
              duration: `${request.seconds}s`,
              delivery: 'inline',
            },
            store: false,
            background: false,
            stream: false,
          }),
          ...(signal ? { signal } : {}),
        }),
        model,
      )
      if (body.status && body.status !== 'completed')
        throw new Error(body.error?.message || `${model} ended ${body.status}`)
      const video = (body.steps ?? [])
        .flatMap((step) => step.content ?? [])
        .find((part) => part.type === 'video')
      if (video?.data) return asVideo(Buffer.from(video.data, 'base64'), model)
      if (video?.uri && new URL(video.uri).host === 'generativelanguage.googleapis.com') {
        return asVideo(
          await okBytes(
            await fetchImpl(video.uri, {
              headers: { 'x-goog-api-key': chosen.apiKey },
              ...(signal ? { signal } : {}),
            }),
            model,
          ),
          model,
        )
      }
      throw new Error(`${model} returned no video`)
    }
    case 'minimax': {
      const auth = { authorization: `Bearer ${chosen.apiKey}` }
      const started = await okJson<{ task_id?: string }>(
        await fetchImpl('https://api.minimax.io/v2/video_generation', {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: chosen.modelId,
            content: [
              { type: 'text', text: request.prompt },
              ...(request.image
                ? [
                    {
                      type: 'image_url',
                      image_url: { url: dataUrl(request.image) },
                      role: 'first_frame',
                    },
                  ]
                : []),
            ],
            resolution: '768P',
            duration: request.seconds,
            // From a picture the video takes the picture's shape.
            ratio: request.image ? 'adaptive' : RATIO[request.shape],
          }),
          ...(signal ? { signal } : {}),
        }),
        model,
      )
      if (!started.task_id) throw new Error(`${model} started no job`)
      for (;;) {
        await wait(LOOK_EVERY_MS.minimax, signal)
        const { task } = await okJson<{
          task?: { status?: string; content?: { url?: string }; error?: { message?: string } }
        }>(
          await fetchImpl(
            `https://api.minimax.io/v2/query/video_generation/${encodeURIComponent(started.task_id)}`,
            { headers: auth, ...(signal ? { signal } : {}) },
          ),
          model,
        )
        if (task?.status === 'failed' || task?.status === 'cancelled')
          throw new Error(task.error?.message || `${model} ${task.status}`)
        if (task?.status !== 'succeeded') continue
        if (!task.content?.url) throw new Error(`${model} returned no video`)
        return asVideo(
          await okBytes(await fetchImpl(task.content.url, signal ? { signal } : {}), model),
          model,
        )
      }
    }
  }
}
