import * as results from '../core/repos/results.ts'
import { getCtx } from '../lib/ctx.ts'
import { newRouter } from './http.ts'

/** Saved results: list, metadata, download, preview, delete. Agents save them during turns. */
export const resultsRouter = newRouter()

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
      limit,
      offset,
    }),
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
  const text = ['text/plain', 'text/markdown'].includes(result.mimeType)
  const image = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(result.mimeType)
  if ((!text && !image) || result.byteLength > (text ? 256 * 1024 : 10 * 1024 * 1024)) {
    return c.json({ error: 'Preview is unavailable for this file. Use Download.' }, 415)
  }
  try {
    const bytes = results.read(db, result.id)
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
    return c.body(new Uint8Array(bytes))
  } catch {
    return c.json({ error: 'Saved file failed integrity verification' }, 409)
  }
})
