// The gateway boundary. TanStack Start runs this middleware for every request it handles: pages,
// the /api/* forwarder and server functions alike, so each check below exists once.

import { isLoopbackHost, type PublicOriginConfig, publicOriginConfig } from '@bazilion/api-types'
import { createMiddleware, createStart } from '@tanstack/react-start'
import { cookieValues } from './lib/cookies'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  // Chromium derives the Origin of a same-origin form POST from the referrer policy; `no-referrer`
  // would send `Origin: null` and fail the login check below. `same-origin` still withholds
  // referrers from every other site.
  'referrer-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'x-frame-options': 'DENY',
  'content-security-policy':
    "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
}

function text(body: string, status: number): Response {
  return new Response(body, { status })
}

/** The refusal for a request that may not pass, or null. */
function refuse(request: Request, config: PublicOriginConfig): Response | null {
  const url = new URL(request.url)
  const origin = config.origin ?? url.origin
  if (config.production) {
    const host = new URL(origin).host
    if (request.headers.get('host') !== host) return text('not found', 404)
    const forwardedHost = request.headers.get('x-forwarded-host')
    const forwardedProto = request.headers.get('x-forwarded-proto')
    if (
      (forwardedHost && forwardedHost !== host) ||
      (forwardedProto && forwardedProto !== 'https')
    ) {
      return text('invalid forwarding headers', 400)
    }
  } else if (!isLoopbackHost(url.hostname)) {
    return text('loopback development only', 403)
  }
  if (request.headers.has('forwarded')) return text('invalid forwarding headers', 400)
  const cookies = request.headers.get('cookie')
  const sessions = cookieValues(cookies, config.sessionCookie)
  const csrfs = cookieValues(cookies, config.csrfCookie)
  if (sessions.length > 1 || csrfs.length > 1) return text('ambiguous cookies', 400)
  if (SAFE_METHODS.has(request.method)) return null

  // A state-changing request that carries the browser session (or logs in) must come from this
  // origin, and a session request must also echo the session's CSRF cookie. Login is checked by
  // Origin only: its HTML form cannot send the CSRF header, a stale cookie from an ended session
  // must not lock the owner out, and the daemon replaces both cookies with a fresh session.
  // Bearer and anonymous requests are left to the daemon, which authenticates every request.
  const session = sessions[0]
  const login = url.pathname === '/api/login'
  if (!session && !login) return null
  if (request.headers.get('origin') !== origin) {
    const form = request.headers
      .get('content-type')
      ?.startsWith('application/x-www-form-urlencoded')
    if (login && form && request.headers.get('accept')?.includes('text/html')) {
      return new Response(null, { status: 303, headers: { location: '/login?error=origin' } })
    }
    return text('origin validation failed', 403)
  }
  if (login) return null
  const csrf = csrfs[0]
  if (!csrf || request.headers.get('x-bazilion-csrf') !== csrf) {
    return text('csrf validation failed', 403)
  }
  return null
}

function withSecurityHeaders(response: Response, production: boolean): Response {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value)
  if (production) headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

const gateway = createMiddleware().server(async ({ request, next }) => {
  const config = publicOriginConfig(process.env.BAZILION_PUBLIC_ORIGIN)
  const refusal = refuse(request, config)
  if (refusal) return withSecurityHeaders(refusal, config.production)
  const result = await next()
  return { ...result, response: withSecurityHeaders(result.response, config.production) }
})

export const startInstance = createStart(() => ({ requestMiddleware: [gateway] }))
