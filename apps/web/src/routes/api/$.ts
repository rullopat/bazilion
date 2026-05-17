// Catch-all reverse proxy: forwards every browser /api/* request to the
// daemon. Browser scripts use relative URLs (/api/agents, /api/groups, …)
// so the bz_token cookie auto-attaches; this proxy translates that cookie
// into a Bearer header for the daemon, which lives on a different origin.
//
// Streams responses (chat NDJSON) and request bodies through unchanged.

import { createFileRoute } from '@tanstack/react-router'
import { getCookie } from '@tanstack/react-start/server'
import { DAEMON_BASE_URL } from '../../lib/daemon-client'

// Hop-by-hop headers per RFC 7230 §6.1, plus host (we're rewriting it) and
// cookie (we translate cookie → bearer ourselves).
const STRIP_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'cookie',
])

const STRIP_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

async function proxy(request: Request): Promise<Response> {
  const incoming = new URL(request.url)
  const target = `${DAEMON_BASE_URL}${incoming.pathname}${incoming.search}`

  const headers = new Headers()
  for (const [k, v] of request.headers) {
    if (!STRIP_REQUEST_HEADERS.has(k.toLowerCase())) headers.set(k, v)
  }
  // Browser sent the bz_token cookie; translate to Bearer for the daemon.
  // If the request already has an Authorization header (CLI/mobile via the
  // web origin — unusual but possible) leave it alone.
  if (!headers.has('authorization')) {
    const token = getCookie('bz_token')
    if (token) headers.set('authorization', `Bearer ${token}`)
  }
  // Stamp Origin so we stay symmetric with @bazilion/client and any future
  // origin checks the daemon adds keep working.
  headers.set('origin', DAEMON_BASE_URL)

  const init: RequestInit = { method: request.method, headers, redirect: 'manual' }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body
    // @ts-expect-error — undici needs duplex:'half' for streaming bodies
    init.duplex = 'half'
  }

  const upstream = await fetch(target, init)

  const respHeaders = new Headers()
  for (const [k, v] of upstream.headers) {
    if (!STRIP_RESPONSE_HEADERS.has(k.toLowerCase())) respHeaders.set(k, v)
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  })
}

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      GET: ({ request }) => proxy(request),
      POST: ({ request }) => proxy(request),
      PUT: ({ request }) => proxy(request),
      PATCH: ({ request }) => proxy(request),
      DELETE: ({ request }) => proxy(request),
    },
  },
})
