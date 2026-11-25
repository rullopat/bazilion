// /api/auth/openai/* — ChatGPT OAuth provider connection state.
// /api/providers/test — model smoke-test.
// /api/login — token exchange for browser session cookies.
// /api/auth/sign-in-link, /api/login/link — a one-time link that signs a browser in.

import {
  type AuthenticatedOwnerResponse,
  type ListSessionsResponse,
  type ProviderTestRequest,
  type ProviderTestResponse,
  publicOriginConfig,
  type SignInLinkResponse,
} from '@bazilion/api-types'
import type { Context } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import {
  ensureSetupSeeded,
  isSetupComplete,
  mergeSecretsIntoEnv,
  webSessionRepo,
  webTokenRepo,
} from '../core/index.ts'
import { parseModelString } from '../core/providers.ts'
import { assertProviderReady } from '../lib/api-key.ts'
import { type AuthVariables, authenticateToken } from '../lib/auth.ts'
import { getCtx } from '../lib/ctx.ts'
import {
  answerWebOpenAIPrompt,
  launchOpenAICodexBrowser,
  preflightOpenAICodexCallback,
  WEB_OPENAI_LOGIN_TIMEOUT_MS,
  webOpenAILoginError,
} from '../lib/openai-oauth-prompt.ts'
import { recordProviderTest } from '../lib/provider-setup.ts'
import { consumeSignInCode, createSignInCode } from '../lib/sign-in-links.ts'
import {
  clearOpenAICodexCredentials,
  getOpenAICodexStatus,
  loadOpenAICodexAccessToken,
  loginOpenAICodex,
  saveOpenAICodexLoginCredentials,
  testProviderModel,
} from '../runtime/index.ts'
import { jsonBody, newRouter } from './http.ts'

export const authRouter = newRouter<{ Variables: AuthVariables }>()

// ─── Auth probe ──────────────────────────────────────────────────────────

/**
 * Cheap session validator. The web root route calls this on every page load
 * and turns "is the cookie still good?" + "has setup been finished?" into its
 * login and welcome redirects. Reaching this handler means auth passed.
 */
authRouter.get('/auth/whoami', (c) => {
  const { db } = getCtx()
  const principal = c.get('authPrincipal') as AuthenticatedOwnerResponse['principal']
  return c.json({
    authenticated: true,
    setupComplete: isSetupComplete(db),
    publicOrigin: publicOriginConfig(process.env.BAZILION_PUBLIC_ORIGIN).origin,
    principal,
  } satisfies AuthenticatedOwnerResponse)
})

// ─── ChatGPT OAuth ───────────────────────────────────────────────────────

authRouter.get('/auth/openai', (c) => {
  const { db, authToken } = getCtx()
  return c.json(getOpenAICodexStatus(db, authToken))
})

authRouter.put('/auth/openai', async (c) => {
  const body = await jsonBody<{ refresh: unknown; access: unknown; expires: unknown }>(c)
  if (
    !body ||
    typeof body.refresh !== 'string' ||
    typeof body.access !== 'string' ||
    typeof body.expires !== 'number'
  ) {
    return c.json(
      { error: 'body must be { refresh: string, access: string, expires: number }' },
      400,
    )
  }
  const { db, authToken } = getCtx()
  saveOpenAICodexLoginCredentials(db, authToken, {
    refresh: body.refresh,
    access: body.access,
    expires: body.expires,
  })
  return c.json(getOpenAICodexStatus(db, authToken))
})

authRouter.delete('/auth/openai', (c) => {
  const { db, authToken } = getCtx()
  clearOpenAICodexCredentials(db, authToken)
  return c.json({ connected: false, expiresAt: null, accountId: null })
})

// One web login at a time: a second one could not bind the callback port anyway.
let webOpenAILoginActive = false

authRouter.post('/auth/openai/login', async (c) => {
  if (webOpenAILoginActive) {
    return c.json({ error: 'An OpenAI browser login is already in progress.' }, 409)
  }
  webOpenAILoginActive = true
  const { db, authToken } = getCtx()
  const launchFailed = new AbortController()
  const signal = AbortSignal.any([
    c.req.raw.signal,
    AbortSignal.timeout(WEB_OPENAI_LOGIN_TIMEOUT_MS),
    launchFailed.signal,
  ])
  try {
    await preflightOpenAICodexCallback()
    signal.throwIfAborted()
    const creds = await loginOpenAICodex({
      signal,
      notify: (event) => {
        if (event.type === 'auth_url') {
          launchOpenAICodexBrowser(event.url, (error) => launchFailed.abort(error))
        }
      },
      prompt: (prompt) => answerWebOpenAIPrompt(prompt, signal),
    })
    signal.throwIfAborted()
    saveOpenAICodexLoginCredentials(db, authToken, creds)
    return c.json(getOpenAICodexStatus(db, authToken))
  } catch (err) {
    return c.json({ error: webOpenAILoginError(err, signal) }, 400)
  } finally {
    webOpenAILoginActive = false
  }
})

// ─── Provider model smoke-test ───────────────────────────────────────────

authRouter.post('/providers/test', async (c) => {
  const body = await jsonBody<ProviderTestRequest>(c)
  if (!body || typeof body.model !== 'string' || !body.model) {
    return c.json({ error: 'model is required' }, 400)
  }
  const message = typeof body.message === 'string' && body.message ? body.message : 'say hi briefly'
  const ctx = getCtx()
  const { db, authToken, paths } = ctx
  let tested: { providerName: string; modelId: string } | undefined
  const started = Date.now()
  try {
    assertProviderReady(db, authToken, body.model)
    tested = parseModelString(body.model)
    const res = await testProviderModel({
      ...tested,
      env: mergeSecretsIntoEnv(db, authToken),
      ...(tested.providerName === 'openai-codex'
        ? { apiKey: await loadOpenAICodexAccessToken(db, authToken) }
        : {}),
      message,
      signal: c.req.raw.signal,
    })
    recordProviderTest(ctx, tested.providerName, tested.modelId, { ms: Date.now() - started })
    // Provider setup mutations may already have crossed the readiness
    // threshold; repeat the idempotent seed after a real successful request
    // so first-run completion can be coupled to this proof without a race.
    ensureSetupSeeded(db, paths)
    return c.json(res satisfies ProviderTestResponse)
  } catch (err) {
    const error = (err as Error).message
    // A request that reached the provider says something about it; a refused model string does not.
    if (tested && !c.req.raw.signal.aborted) {
      recordProviderTest(ctx, tested.providerName, tested.modelId, { error })
    }
    return c.json({ error }, 400)
  }
})

// ─── Browser login ───────────────────────────────────────────────────────

/** Browsers cap cookie lifetimes at 400 days; the daemon decides when a session ends. */
const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60

/**
 * Browser-session login with any active token — the bootstrap token from
 * auth.json or a device token. Two body shapes accepted:
 *   - `application/json`: `{ token: "<value>" }` → returns `{ ok: true }` on
 *     success, sets the session and CSRF cookies.
 *   - `application/x-www-form-urlencoded`: `token=<value>` → 302 to `/` on
 *     success or `/login?error=token` on failure. Used by the web login form.
 *
 * The browser keeps only the session cookie, never the token. The session
 * expires once unused for 30 days (SESSION_TTL_MS); the cookie itself is kept
 * for the browser's maximum so that sliding expiry is decided by the daemon.
 */
authRouter.post('/login', async (c) => {
  const ct = c.req.header('content-type') ?? ''
  let token: string | null = null

  if (ct.startsWith('application/json')) {
    const body = await jsonBody<{ token: unknown }>(c)
    if (body && typeof body.token === 'string') token = body.token
  } else {
    const form = await c.req.formData().catch(() => null)
    const v = form?.get('token')
    if (typeof v === 'string') token = v
  }

  const principal = token ? authenticateToken(token) : null
  if (!principal) {
    if (ct.startsWith('application/json')) {
      return c.json({ error: 'invalid token' }, 401)
    }
    return c.redirect('/login?error=token', 302)
  }

  startSession(c, principal.tokenId)

  if (ct.startsWith('application/json')) {
    return c.json({ ok: true })
  }
  return c.redirect(firstPage(), 302)
})

/** A browser session for this token: the session cookie and its CSRF cookie. */
function startSession(c: Context, tokenId: string): void {
  const created = webSessionRepo.create(getCtx().db, tokenId)
  const origin = publicOriginConfig(process.env.BAZILION_PUBLIC_ORIGIN)
  const cookie = {
    path: '/',
    secure: origin.production,
    sameSite: 'Strict' as const,
    maxAge: COOKIE_MAX_AGE_SECONDS,
  }
  setCookie(c, origin.sessionCookie, created.cookieValue, { ...cookie, httpOnly: true })
  setCookie(c, origin.csrfCookie, created.csrfToken, { ...cookie, httpOnly: false })
}

/**
 * Where a new session lands. Skip an avoidable redirect through the locked root on a fresh
 * install. Setup mutations seed the defaults synchronously, so completed installs can still
 * enter the workspace directly.
 */
function firstPage(): string {
  return isSetupComplete(getCtx().db) ? '/' : '/welcome'
}

/**
 * A one-time link that signs a browser in as the calling token, for the CLI (`bazilion open`,
 * `bazilion dashboard`): it opens the link so nobody pastes a token. Only a token may ask, not
 * a browser session. The link is a path on the web UI, which forwards it here.
 */
authRouter.post('/auth/sign-in-link', (c) => {
  const principal = c.get('authPrincipal')
  if (principal.kind === 'session') {
    return c.json({ error: 'a sign-in link is asked for with a token, not a browser session' }, 403)
  }
  const { code, expiresAt } = createSignInCode(principal.tokenId)
  return c.json({
    path: `/api/login/link?code=${encodeURIComponent(code)}`,
    expiresAt,
  } satisfies SignInLinkResponse)
})

/**
 * Opening a sign-in link: a used, expired or unknown code, or one whose token was revoked
 * meanwhile, goes to the login page, which says so.
 */
authRouter.get('/login/link', (c) => {
  const code = c.req.query('code')
  const tokenId = code ? consumeSignInCode(code) : null
  const token = tokenId ? webTokenRepo.get(getCtx().db, tokenId) : null
  const active =
    token && token.revokedAt === null && (token.expiresAt === null || token.expiresAt > Date.now())
  if (!token || !active) return c.redirect('/login?error=link', 302)
  startSession(c, token.id)
  return c.redirect(firstPage(), 302)
})

authRouter.post('/logout', (c) => {
  const principal = c.get('authPrincipal') as AuthenticatedOwnerResponse['principal']
  if (principal.kind !== 'session' || !principal.sessionId) {
    return c.json({ error: 'browser session required' }, 400)
  }
  webSessionRepo.revoke(getCtx().db, principal.sessionId)
  const origin = publicOriginConfig(process.env.BAZILION_PUBLIC_ORIGIN)
  deleteCookie(c, origin.sessionCookie, { path: '/', secure: origin.production })
  deleteCookie(c, origin.csrfCookie, { path: '/', secure: origin.production })
  return c.json({ ok: true })
})

authRouter.get('/sessions', (c) => {
  const principal = c.get('authPrincipal') as AuthenticatedOwnerResponse['principal']
  return c.json({
    sessions: webSessionRepo.list(getCtx().db, { currentId: principal.sessionId ?? undefined }),
  } satisfies ListSessionsResponse)
})

authRouter.delete('/sessions/:id', (c) => {
  if (!webSessionRepo.revoke(getCtx().db, c.req.param('id'))) {
    return c.json({ error: 'session not found' }, 404)
  }
  return c.body(null, 204)
})
