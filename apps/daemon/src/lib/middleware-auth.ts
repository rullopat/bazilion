// Hono auth + first-run gate middleware.
//
// Mirrors what apps/web/src/middleware.ts used to do for `/api/*` paths,
// but framework-typed for Hono. Web SSR auth (login redirect, welcome
// redirect) stays in the Astro app's own middleware — the daemon only
// returns JSON status codes; the web app translates those to redirects.

import type { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import { isSetupComplete, webSessionRepo, webTokenRepo } from '../core/index.ts'
import { authenticateToken, extractBearer } from './auth.ts'
import { getCtx } from './ctx.ts'
import { resolvePublicOrigin } from './public-origin.ts'

/** Reachable without a token. The login route mints them; health is a probe. */
const PUBLIC_PATHS = new Set(['/api/login', '/api/health'])

/**
 * Once authenticated, these paths still pass through the first-run gate so
 * users can finish their initial setup. Everything else 409s until the user
 * has at least one enabled provider with ≥1 curated model.
 */
const SETUP_OPEN_PREFIXES = [
  '/api/config',
  '/api/auth',
  '/api/health',
  // Credential management must remain usable during setup: the first-run
  // browser exchange is bounded, and the local CLI can mint a named device
  // credential before provider setup has unlocked the rest of the API.
  '/api/tokens',
  '/api/sessions',
  // A fresh installation must be able to prove provider connectivity before
  // the provider gate opens the rest of the product.
  '/api/providers/test',
]

function isSetupOpen(path: string): boolean {
  for (const prefix of SETUP_OPEN_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return true
  }
  return false
}

// biome-ignore lint/suspicious/noConfusingVoidType: hono's Next() returns Promise<void>; the union is the framework's middleware contract.
export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  const path = c.req.path
  if (PUBLIC_PATHS.has(path)) {
    await next()
    return
  }

  const bearer = extractBearer(c.req.header('authorization'))
  const origin = resolvePublicOrigin()
  const sessionCookie = getCookie(c, origin.sessionCookie)
  const bearerPrincipal = bearer ? authenticateToken(bearer) : null
  const session =
    !bearer && sessionCookie ? webSessionRepo.authenticate(getCtx().db, sessionCookie) : null
  const principal =
    bearerPrincipal ??
    (session
      ? {
          kind: 'session' as const,
          tokenId: session.deviceTokenId,
          label: session.deviceLabel,
          sessionId: session.id,
        }
      : null)

  if (!principal) {
    if (bearer) {
      const reason = webTokenRepo.rejectionReason(getCtx().db, bearer)
      return c.json({ error: `credential ${reason}`, code: `credential_${reason}` }, 401)
    }
    return c.json({ error: 'unauthorized' }, 401)
  }
  if (session && !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const csrfCookie = getCookie(c, origin.csrfCookie)
    const csrfHeader = c.req.header('x-bazilion-csrf')
    if (
      !csrfCookie ||
      !csrfHeader ||
      csrfCookie !== csrfHeader ||
      !webSessionRepo.csrfMatches(session, csrfHeader)
    ) {
      return c.json({ error: 'csrf validation failed' }, 403)
    }
  }
  c.set('authPrincipal', principal)
  if (session) c.set('authSession', session)

  if (!isSetupOpen(path) && !isSetupComplete(getCtx().db)) {
    return c.json({ error: 'setup incomplete' }, 409)
  }

  await next()
}
