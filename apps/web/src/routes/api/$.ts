// Catch-all reverse proxy: forwards every browser /api/* request to the
// daemon. Browser scripts use relative URLs (/api/agents, /api/teams, …)
// so the bounded session and CSRF cookies auto-attach. Native clients retain
// bearer auth through this same private HTTPS origin.
//
// Streams responses (chat NDJSON) and request bodies through unchanged.

import { createFileRoute } from '@tanstack/react-router'
import { getCookie } from '@tanstack/react-start/server'
import { DAEMON_BASE_URL } from '../../lib/daemon-client'
import { webOriginConfig } from '../../lib/public-origin'

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
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
])

const MAX_JSON_BODY = 2 * 1024 * 1024
const MAX_UPLOAD_BODY = 25 * 1024 * 1024

function isLoopback(hostname: string): boolean {
  return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname)
}

function boundedBody(body: ReadableStream<Uint8Array>, limit: number): ReadableStream<Uint8Array> {
  let seen = 0
  return body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        seen += chunk.byteLength
        if (seen > limit) throw new Error('request body exceeds gateway limit')
        controller.enqueue(chunk)
      },
    }),
  )
}

function addSecurityHeaders(headers: Headers, production: boolean): void {
  headers.set('x-content-type-options', 'nosniff')
  headers.set('referrer-policy', 'no-referrer')
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()')
  headers.set('x-frame-options', 'DENY')
  headers.set(
    'content-security-policy',
    "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
  )
  if (production) headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains')
}

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
  const originConfig = webOriginConfig()
  const expectedOrigin = originConfig.origin ?? incoming.origin
  const expected = new URL(expectedOrigin)
  if (originConfig.production) {
    if (request.headers.get('host') !== expected.host) {
      return new Response('not found', { status: 404 })
    }
    const forwardedHost = request.headers.get('x-forwarded-host')
    const forwardedProto = request.headers.get('x-forwarded-proto')
    if ((forwardedHost && forwardedHost !== expected.host) || (forwardedProto && forwardedProto !== 'https')) {
      return new Response('invalid forwarding headers', { status: 400 })
    }
  } else if (!isLoopback(incoming.hostname)) {
    return new Response('loopback development only', { status: 403 })
  }
  if (request.headers.has('forwarded')) {
    return new Response('invalid forwarding headers', { status: 400 })
  }

  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
  const session = getCookie(originConfig.sessionCookie)
  const csrf = getCookie(originConfig.csrfCookie)
  if (unsafe && (session || incoming.pathname === '/api/login')) {
    if (request.headers.get('origin') !== expectedOrigin) {
      return new Response('origin validation failed', { status: 403 })
    }
    if (session && (!csrf || request.headers.get('x-bazilion-csrf') !== csrf)) {
      return new Response('csrf validation failed', { status: 403 })
    }
  }

  const target = `${DAEMON_BASE_URL}${incoming.pathname}${incoming.search}`

  const headers = new Headers()
  for (const [k, v] of request.headers) {
    if (!STRIP_REQUEST_HEADERS.has(k.toLowerCase())) headers.set(k, v)
  }
  if (session) {
    const cookieParts = [`${originConfig.sessionCookie}=${session}`]
    if (csrf) cookieParts.push(`${originConfig.csrfCookie}=${csrf}`)
    headers.set('cookie', cookieParts.join('; '))
  }
  // Stamp Origin so we stay symmetric with @bazilion/client and any future
  // origin checks the daemon adds keep working.
  headers.set('origin', DAEMON_BASE_URL)

  const init: RequestInit = { method: request.method, headers, redirect: 'manual' }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const contentType = request.headers.get('content-type') ?? ''
    const limit = contentType.startsWith('multipart/form-data') ? MAX_UPLOAD_BODY : MAX_JSON_BODY
    const contentLength = Number(request.headers.get('content-length') ?? 0)
    if (Number.isFinite(contentLength) && contentLength > limit) {
      return new Response('request body too large', { status: 413 })
    }
    if (request.body) init.body = boundedBody(request.body, limit)
    // @ts-expect-error — undici needs duplex:'half' for streaming bodies
    init.duplex = 'half'
  }

  const upstream = await fetch(target, init)

  const respHeaders = new Headers()
  for (const [k, v] of upstream.headers) {
    const lower = k.toLowerCase()
    if (lower !== 'set-cookie' && !STRIP_RESPONSE_HEADERS.has(lower)) respHeaders.set(k, v)
  }
  const getSetCookie = (upstream.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
  for (const value of getSetCookie?.call(upstream.headers) ?? []) respHeaders.append('set-cookie', value)
  addSecurityHeaders(respHeaders, originConfig.production)

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
