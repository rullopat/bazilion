// Hono auth + first-run gate middleware.
//
// The daemon only answers with JSON status codes; the web app's root route
// turns 401/409 into its login and welcome redirects.

import { publicOriginConfig } from '@bazilion/api-types'
import type { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import { isSetupComplete, webSessionRepo, webTokenRepo } from '../core/index.ts'
import { authenticateToken, extractBearer } from './auth.ts'
import { getCtx } from './ctx.ts'

/** Reachable without a token. The login route mints sessions; health is a probe. */
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
  // Credential and session management stay usable during setup.
  '/api/tokens',
  '/api/sessions',
  '/api/logout',
  // The rest of the Setup pages (/config/*) and its backup download.
  '/api/mcp-servers',
  '/api/notifications',
  '/api/backup',
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
  const origin = publicOriginConfig(process.env.BAZILION_PUBLIC_ORIGIN)
  const sessionCookie = getCookie(c, origin.sessionCookie)
  const bearerPrincipal = bearer ? authenticateToken(bearer) : null
  const session =
    !bearer && sessionCookie ? webSessionRepo.authenticate(getCtx().db, sessionCookie) : null
  const principal =
    bearerPrincipal ??
    (session
      ? {
          kind: 'session' as const,
          tokenId: session.tokenId,
          label: session.tokenLabel,
          sessionId: session.id,
        }
      : null)

  if (!principal) {
    if (bearer) {
      const reason = webTokenRepo.rejectionReason(getCtx().db, bearer)
      return c.json({ error: `credential ${reason}` }, 401)
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
