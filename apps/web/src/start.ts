import { createMiddleware, createStart } from '@tanstack/react-start'
import { webOriginConfig } from './lib/public-origin'

function isLoopback(hostname: string): boolean {
  return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname)
}

function secureHeaders(headers: Headers, production: boolean): void {
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

const securityBoundary = createMiddleware().server(async ({ request, next }) => {
  const config = webOriginConfig()
  const incoming = new URL(request.url)
  if (config.production) {
    const expected = new URL(config.origin as string)
    if (request.headers.get('host') !== expected.host) return new Response('not found', { status: 404 })
    const forwardedHost = request.headers.get('x-forwarded-host')
    const forwardedProto = request.headers.get('x-forwarded-proto')
    if ((forwardedHost && forwardedHost !== expected.host) || (forwardedProto && forwardedProto !== 'https')) {
      return new Response('invalid forwarding headers', { status: 400 })
    }
  } else if (!isLoopback(incoming.hostname)) {
    return new Response('loopback development only', { status: 403 })
  }
  if (request.headers.has('forwarded')) return new Response('invalid forwarding headers', { status: 400 })
  const result = await next()
  const headers = new Headers(result.response.headers)
  secureHeaders(headers, config.production)
  return {
    ...result,
    response: new Response(result.response.body, {
      status: result.response.status,
      statusText: result.response.statusText,
      headers,
    }),
  }
})

export const startInstance = createStart(() => ({ requestMiddleware: [securityBoundary] }))
