import { isTextPreview } from '@bazilion/api-types'
import * as results from '../core/repos/results.ts'
import { getCtx } from '../lib/ctx.ts'
import { zipStream } from '../lib/zip.ts'
import { newRouter } from './http.ts'

/** Saved results: list, metadata, download, archive, preview, delete. Agents save them during turns. */
export const resultsRouter = newRouter()

/** The most one archive holds; a larger selection is refused, never cut silently. */
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024

resultsRouter.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff')
  await next()
})

resultsRouter.get('/', (c) => {
  const limit = Number(c.req.query('limit') ?? 50)
  const offset = Number(c.req.query('offset') ?? 0)
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  ) {
    return c.json({ error: 'limit must be 1–100 and offset must be a nonnegative integer' }, 400)
  }
  return c.json(
    results.list(getCtx().db, {
      teamId: c.req.query('teamId'),
      agentId: c.req.query('agentId'),
      sessionId: c.req.query('sessionId'),
      limit,
      offset,
    }),
  )
})

// Every saved file of a Team, an Agent or a conversation as one zip. Registered before `/:id`.
resultsRouter.get('/archive', (c) => {
  const db = getCtx().db
  const filter = {
    teamId: c.req.query('teamId'),
    agentId: c.req.query('agentId'),
    sessionId: c.req.query('sessionId'),
  }
  if (!filter.teamId && !filter.agentId && !filter.sessionId) {
    return c.json({ error: 'teamId, agentId or sessionId is required' }, 400)
  }
  const selected = results.listForArchive(db, filter, MAX_ARCHIVE_BYTES)
  if (selected.truncated) {
    return c.json(
      { error: 'These files are larger than 512 MiB together. Narrow the selection.' },
      413,
    )
  }
  if (selected.results.length === 0) return c.json({ error: 'No saved files match' }, 404)
  const name = `bazilion-${filter.teamId ?? 'files'}.zip`.replace(/[^\w.-]/g, '-')
  c.header('Content-Type', 'application/zip')
  c.header('Content-Disposition', `attachment; filename="${name}"`)
  c.header('Content-Security-Policy', "default-src 'none'; sandbox")
  return c.body(
    zipStream(
      selected.results.map((result) => ({
        name: result.name,
        modifiedAt: result.createdAt,
        // Read when the stream reaches the file; a failed integrity check ends the download.
        read: () => new Uint8Array(results.read(db, result.id)),
      })),
    ),
  )
})

resultsRouter.get('/:id', (c) => {
  const result = results.get(getCtx().db, c.req.param('id'))
  if (!result) return c.json({ error: 'Result not found' }, 404)
  return c.json({ result })
})

resultsRouter.get('/:id/download', (c) => {
  const db = getCtx().db
  const result = results.get(db, c.req.param('id'))
  if (!result) return c.json({ error: 'Result not found' }, 404)
  try {
    const bytes = results.read(db, result.id)
    const filename = encodeURIComponent(result.name).replace(
      /[!'()*]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    )
    c.header('Content-Type', 'application/octet-stream')
    c.header('Content-Disposition', `attachment; filename="result"; filename*=UTF-8''${filename}`)
    c.header('Content-Security-Policy', "default-src 'none'; sandbox")
    c.header('Content-Length', String(bytes.byteLength))
    return c.body(new Uint8Array(bytes))
  } catch {
    return c.json(
      { error: 'Saved file failed integrity verification and cannot be downloaded' },
      409,
    )
  }
})

/** Audio and video a page plays where it was delivered (BAZ-095, BAZ-096). */
const PLAYABLE = /^(audio|video)\/[a-z0-9.+-]+$/

// A sound or a video to play in the page, inline and in parts, so that a player can seek.
resultsRouter.get('/:id/media', (c) => {
  const db = getCtx().db
  const result = results.get(db, c.req.param('id'))
  if (!result) return c.json({ error: 'Result not found' }, 404)
  if (!PLAYABLE.test(result.mimeType))
    return c.json({ error: 'Only sounds and videos are played. Use Download.' }, 415)
  let bytes: Buffer
  try {
    bytes = results.read(db, result.id)
  } catch {
    return c.json({ error: 'Saved file failed integrity verification and cannot be played' }, 409)
  }
  c.header('Content-Type', result.mimeType)
  c.header('Accept-Ranges', 'bytes')
  c.header('Content-Security-Policy', "default-src 'none'; sandbox")
  c.header('Cache-Control', 'private, max-age=3600')
  const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('range') ?? '')
  if (!range) {
    c.header('Content-Length', String(bytes.byteLength))
    return c.body(new Uint8Array(bytes))
  }
  const size = bytes.byteLength
  const [, from, to] = range
  // "bytes=-500" is the last 500 bytes; "bytes=100-" is from 100 to the end.
  const start = from ? Number(from) : Math.max(0, size - Number(to))
  const end = from && to ? Math.min(Number(to), size - 1) : size - 1
  if (!(start <= end && start < size)) {
    c.header('Content-Range', `bytes */${size}`)
    return c.body(null, 416)
  }
  c.header('Content-Range', `bytes ${start}-${end}/${size}`)
  c.header('Content-Length', String(end - start + 1))
  return c.body(new Uint8Array(bytes.subarray(start, end + 1)), 206)
})

/** Pages and drawings the web shows in a sealed frame (BAZ-097). */
const CANVAS_TYPES = new Set(['text/html', 'image/svg+xml'])

// The text of an HTML page or SVG drawing, for the web's sealed frame. Sent as inert text: the
// frame, not this response, is where it runs.
resultsRouter.get('/:id/canvas', (c) => {
  const db = getCtx().db
  const result = results.get(db, c.req.param('id'))
  if (!result) return c.json({ error: 'Result not found' }, 404)
  if (!CANVAS_TYPES.has(result.mimeType))
    return c.json({ error: 'Only HTML pages and SVG drawings are shown in a frame.' }, 415)
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(results.read(db, result.id))
    c.header('Content-Type', 'text/plain; charset=utf-8')
    c.header('Content-Security-Policy', "default-src 'none'; sandbox")
    c.header('Cache-Control', 'private, max-age=3600')
    return c.body(text)
  } catch {
    return c.json({ error: 'This file is not text. Use Download.' }, 415)
  }
})

resultsRouter.delete('/:id', (c) => {
  if (!results.remove(getCtx().db, c.req.param('id'))) {
    return c.json({ error: 'Result not found' }, 404)
  }
  return c.json({ deleted: true })
})

resultsRouter.get('/:id/preview', (c) => {
  const db = getCtx().db
  const result = results.get(db, c.req.param('id'))
  if (!result) return c.json({ error: 'Result not found' }, 404)
  const text = isTextPreview(result)
  const image = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(result.mimeType)
  if (!text && (!image || result.byteLength > 10 * 1024 * 1024)) {
    return c.json({ error: 'Preview is unavailable for this file. Use Download.' }, 415)
  }
  // A tile shows only the start of a text file: `?bytes=` cuts it, on a whole character.
  const bytesParam = Number(c.req.query('bytes'))
  const cut = text && Number.isInteger(bytesParam) && bytesParam > 0 ? bytesParam : null
  try {
    const bytes = results.read(db, result.id)
    if (text) {
      let shown: string
      try {
        shown = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        return c.json({ error: 'This file is not text. Use Download.' }, 415)
      }
      if (shown.includes('\u0000'))
        return c.json({ error: 'This file is not text. Use Download.' }, 415)
      if (cut !== null && Buffer.byteLength(shown) > cut) {
        // Whole characters only: drop a last one cut in half.
        shown = Buffer.from(shown)
          .subarray(0, cut)
          .toString('utf8')
          .replace(/\uFFFD$/, '')
      }
      c.header('Content-Type', 'text/plain; charset=utf-8')
      c.header('X-Content-Type-Options', 'nosniff')
      c.header('Content-Security-Policy', "default-src 'none'; sandbox")
      c.header('Cache-Control', 'private, max-age=3600')
      return c.body(shown)
    }
    const magic =
      result.mimeType === 'image/png'
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : result.mimeType === 'image/jpeg'
          ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : result.mimeType === 'image/gif'
            ? ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))
            : result.mimeType === 'image/webp'
              ? bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
                bytes.subarray(8, 12).toString('ascii') === 'WEBP'
              : false
    if (image && !magic)
      return c.json({ error: 'File content does not match its image type. Use Download.' }, 415)
    c.header('Content-Type', text ? 'text/plain; charset=utf-8' : result.mimeType)
    c.header('Content-Security-Policy', "default-src 'none'; sandbox")
    // A saved file never changes under its id, so a gallery does not fetch it again each visit.
    c.header('Cache-Control', 'private, max-age=3600')
    return c.body(new Uint8Array(bytes))
  } catch {
    return c.json({ error: 'Saved file failed integrity verification' }, 409)
  }
})
