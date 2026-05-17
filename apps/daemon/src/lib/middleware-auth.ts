// Hono auth + first-run gate middleware.
//
// Mirrors what apps/web/src/middleware.ts used to do for `/api/*` paths,
// but framework-typed for Hono. Web SSR auth (login redirect, welcome
// redirect) stays in the Astro app's own middleware — the daemon only
// returns JSON status codes; the web app translates those to redirects.

import type { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import { isSetupComplete } from '../core/index.ts'
import { extractBearer, isValidToken } from './auth.ts'
import { getCtx } from './ctx.ts'

/** Reachable without a token. The login route mints them; health is a probe. */
const PUBLIC_PATHS = new Set(['/api/login', '/api/health'])

/**
 * Once authenticated, these paths still pass through the first-run gate so
 * users can finish their initial setup. Everything else 409s until the user
 * has at least one enabled provider with ≥1 curated model.
 */
const SETUP_OPEN_PREFIXES = ['/api/config', '/api/auth', '/api/health']

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
  const cookie = getCookie(c, 'bz_token')
  const token = bearer ?? cookie

  if (!token || !isValidToken(token)) {
    return c.json({ error: 'unauthorized' }, 401)
  }

  if (!isSetupOpen(path) && !isSetupComplete(getCtx().db)) {
    return c.json({ error: 'setup incomplete' }, 409)
  }

  await next()
}
