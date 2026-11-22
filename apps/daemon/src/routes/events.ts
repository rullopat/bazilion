// /api/events: the live feed as server-sent events (see lib/live.ts). A comment line every 20
// seconds keeps proxies from closing a quiet stream; each time, the credential is checked again,
// and a revoked or expired one ends the stream.

import { streamSSE } from 'hono/streaming'
import { liveFeed } from '../lib/live.ts'
import { credentialCheck } from '../lib/middleware-auth.ts'
import { newRouter } from './http.ts'

let keepaliveMs = 20_000

/** Test-only: check the credential more often than every 20 seconds. */
export function _setKeepaliveForTest(ms: number): void {
  keepaliveMs = ms
}

export const eventsRouter = newRouter()

eventsRouter.get('/', (c) => {
  const stillValid = credentialCheck(c)
  c.header('cache-control', 'no-store')
  c.header('x-accel-buffering', 'no')
  return streamSSE(c, async (stream) => {
    let id = 0
    const unsubscribe = liveFeed().subscribe((event) => {
      void stream.writeSSE({ event: event.type, data: JSON.stringify(event), id: String(++id) })
    })
    let keepalive: NodeJS.Timeout | undefined
    try {
      await new Promise<void>((resolve) => {
        stream.onAbort(resolve)
        c.req.raw.signal.addEventListener('abort', () => resolve(), { once: true })
        keepalive = setInterval(() => {
          if (stillValid()) void stream.write(': keepalive\n\n')
          else resolve()
        }, keepaliveMs)
      })
    } finally {
      clearInterval(keepalive)
      unsubscribe()
    }
  })
})
