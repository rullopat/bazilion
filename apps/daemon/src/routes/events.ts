// /api/events: the live feed as server-sent events (see lib/live.ts). A comment line every 20
// seconds keeps proxies from closing a quiet stream.

import { streamSSE } from 'hono/streaming'
import { liveFeed } from '../lib/live.ts'
import { newRouter } from './http.ts'

const KEEPALIVE_MS = 20_000

export const eventsRouter = newRouter()

eventsRouter.get('/', (c) => {
  c.header('cache-control', 'no-store')
  c.header('x-accel-buffering', 'no')
  return streamSSE(c, async (stream) => {
    let id = 0
    const unsubscribe = liveFeed().subscribe((event) => {
      void stream.writeSSE({ event: event.type, data: JSON.stringify(event), id: String(++id) })
    })
    const keepalive = setInterval(() => void stream.write(': keepalive\n\n'), KEEPALIVE_MS)
    try {
      await new Promise<void>((resolve) => {
        stream.onAbort(resolve)
        c.req.raw.signal.addEventListener('abort', () => resolve(), { once: true })
      })
    } finally {
      clearInterval(keepalive)
      unsubscribe()
    }
  })
})
