// Forwards every same-origin /api/* request to the loopback daemon and streams the response back
// (chat NDJSON included). The middleware in src/start.ts has already checked the authority,
// Origin and CSRF; the daemon authenticates the request.

import { publicOriginConfig } from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { readCookie } from '../../lib/cookies'
import { DAEMON_BASE_URL } from '../../lib/daemon-client'

const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]
// The client's forwarding identity never reaches the daemon; cookies are rebuilt below.
const STRIP_REQUEST = new Set([
  ...HOP_BY_HOP,
  'host',
  'cookie',
  'content-length',
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
])
const STRIP_RESPONSE = new Set([...HOP_BY_HOP, 'set-cookie'])

/**
 * Fits a 25 MB chat attachment sent as base64 JSON and a 50 MB skill ZIP; the daemon applies its
 * own per-route limits. Only a request carrying a credential (the session cookie or a bearer) gets
 * it: the gateway buffers bodies before the daemon authenticates, and an anonymous request can
 * only log in.
 */
const MAX_BODY = 64 * 1024 * 1024
const MAX_ANONYMOUS_BODY = 64 * 1024

/**
 * The request body, buffered (an upstream 401 on a one-shot stream body surfaced as a gateway
 * 500), or null when it is larger than `limit`.
 */
async function readBody(request: Request, limit: number): Promise<Blob | null> {
  if (Number(request.headers.get('content-length') ?? 0) > limit) return null
  const chunks: Uint8Array<ArrayBuffer>[] = []
  if (!request.body) return new Blob(chunks)
  const reader = request.body.getReader()
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return new Blob(chunks)
    size += value.byteLength
    if (size > limit) {
      await reader.cancel('request body exceeds the gateway limit')
      return null
    }
    chunks.push(value as Uint8Array<ArrayBuffer>)
  }
}

async function forward(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const headers = new Headers()
  for (const [name, value] of request.headers) {
    if (!STRIP_REQUEST.has(name)) headers.set(name, value)
  }
  const origin = publicOriginConfig(process.env.BAZILION_PUBLIC_ORIGIN)
  const cookies = request.headers.get('cookie')
  const session = readCookie(cookies, origin.sessionCookie)
  const forwarded = [origin.sessionCookie, origin.csrfCookie]
    .map((name) => [name, readCookie(cookies, name)])
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}=${value}`)
  if (forwarded.length > 0) headers.set('cookie', forwarded.join('; '))

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'manual',
    // A closed browser connection cancels the daemon request, so long chat and OAuth requests
    // release their work instead of waiting for a timeout.
    signal: request.signal,
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const credentialed = Boolean(session) || request.headers.has('authorization')
    const body = await readBody(request, credentialed ? MAX_BODY : MAX_ANONYMOUS_BODY)
    if (!body) return new Response('request body too large', { status: 413 })
    init.body = body
  }

  const upstream = await fetch(`${DAEMON_BASE_URL}${url.pathname}${url.search}`, init)
  const responseHeaders = new Headers()
  for (const [name, value] of upstream.headers) {
    if (!STRIP_RESPONSE.has(name)) responseHeaders.set(name, value)
  }
  for (const value of upstream.headers.getSetCookie()) responseHeaders.append('set-cookie', value)
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  })
}

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      GET: ({ request }) => forward(request),
      POST: ({ request }) => forward(request),
      PUT: ({ request }) => forward(request),
      PATCH: ({ request }) => forward(request),
      DELETE: ({ request }) => forward(request),
    },
  },
})
