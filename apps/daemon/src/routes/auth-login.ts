// /api/auth/openai/* — ChatGPT OAuth provider connection state.
// /api/providers/test — model smoke-test.
// /api/login — device-token exchange for bounded browser session cookies.

import type {
  AuthenticatedOwnerResponse,
  ListSessionsResponse,
  ProviderTestRequest,
  ProviderTestResponse,
} from '@bazilion/api-types'
import { Hono } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import {
  ensureSetupSeeded,
  isSetupComplete,
  mergeSecretsIntoEnv,
  providerStateRepo,
  webSessionRepo,
  webTokenRepo,
} from '../core/index.ts'
import { type AuthVariables, authenticateToken } from '../lib/auth.ts'
import { getCtx } from '../lib/ctx.ts'
import {
  acquireWebOpenAILogin,
  answerWebOpenAIPrompt,
  createWebOpenAILoginLifetime,
  launchOpenAICodexBrowser,
  preflightOpenAICodexCallback,
} from '../lib/openai-oauth-prompt.ts'
import { resolvePublicOrigin } from '../lib/public-origin.ts'
import {
  clearOpenAICodexCredentials,
  createProviderRegistry,
  getOpenAICodexStatus,
  loadProviderConfigFromEnv,
  loginOpenAICodex,
  saveOpenAICodexLoginCredentials,
} from '../runtime/index.ts'

export const authRouter = new Hono<{ Variables: AuthVariables }>()

// ─── Auth probe ──────────────────────────────────────────────────────────

/**
 * Cheap session validator. Web SSR middleware calls this once per request
 * to translate "is the cookie still good?" + "has setup been finished?"
 * into JSON-status pairs that the Astro middleware turns into redirects.
 *
 * Reaching this handler at all means auth passed (the daemon's own
 * middleware-auth would have 401'd otherwise). The body just exposes the
 * setup-complete bit so the web layer can route accordingly.
 */
authRouter.get('/auth/whoami', (c) => {
  const { db } = getCtx()
  const principal = c.get('authPrincipal') as AuthenticatedOwnerResponse['principal']
  return c.json({
    authenticated: true,
    setupComplete: isSetupComplete(db),
    publicOrigin: resolvePublicOrigin().origin,
    principal,
  } satisfies AuthenticatedOwnerResponse)
})

// ─── ChatGPT OAuth ───────────────────────────────────────────────────────

authRouter.get('/auth/openai', (c) => {
  const { db, authToken } = getCtx()
  return c.json(getOpenAICodexStatus(db, authToken))
})

authRouter.put('/auth/openai', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    refresh?: unknown
    access?: unknown
    expires?: unknown
  } | null
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

authRouter.post('/auth/openai/login', async (c) => {
  const { db, authToken } = getCtx()
  const lifetime = createWebOpenAILoginLifetime(c.req.raw.signal)
  let releaseLogin: (() => void) | undefined
  try {
    releaseLogin = await acquireWebOpenAILogin(lifetime.signal)
    if (lifetime.signal.aborted) throw lifetime.signal.reason
    await preflightOpenAICodexCallback()
    if (lifetime.signal.aborted) throw lifetime.signal.reason
    const creds = await loginOpenAICodex({
      signal: lifetime.signal,
      notify: (event) => {
        if (event.type === 'auth_url') {
          launchOpenAICodexBrowser(event.url, (error) => lifetime.abort(error))
        }
      },
      prompt: (prompt) => answerWebOpenAIPrompt(prompt, lifetime.signal),
    })
    if (lifetime.signal.aborted) throw lifetime.signal.reason
    saveOpenAICodexLoginCredentials(db, authToken, creds)
    return c.json(getOpenAICodexStatus(db, authToken))
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400)
  } finally {
    releaseLogin?.()
    lifetime.dispose()
  }
})

// ─── Provider model smoke-test ───────────────────────────────────────────

authRouter.post('/providers/test', async (c) => {
  const body = (await c.req.json().catch(() => null)) as ProviderTestRequest | null
  if (!body || typeof body.model !== 'string' || !body.model) {
    return c.json({ error: 'model is required' }, 400)
  }
  const message = typeof body.message === 'string' && body.message ? body.message : 'say hi briefly'
  const { db, authToken } = getCtx()
  const env = mergeSecretsIntoEnv(db, authToken)
  const reg = createProviderRegistry(loadProviderConfigFromEnv(env, { db, authToken }), {
    enabledSet: providerStateRepo.listEnabled(db),
  })
  try {
    const { provider, model } = reg.resolve(body.model)
    const res = await provider.chat({
      model,
      messages: [{ role: 'user', content: message }],
      maxTokens: 256,
    })
    // Provider setup mutations may already have crossed the readiness
    // threshold; repeat the idempotent seed after a real successful request
    // so first-run completion can be coupled to this proof without a race.
    ensureSetupSeeded(db, getCtx().paths)
    const out: ProviderTestResponse = { content: res.content, usage: res.usage }
    return c.json(out)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400)
  }
})

// ─── Browser login ───────────────────────────────────────────────────────

/**
 * Browser-session login. Two body shapes accepted:
 *   - `application/json`: `{ token: "<value>" }` → returns `{ ok: true }` on
 *     success, sets bounded browser session and CSRF cookies.
 *   - `application/x-www-form-urlencoded`: `token=<value>` → 302 to `/` on
 *     success or `/login?error=token` on failure. Used by the web login form.
 *
 * Normally the submitted credential must be a revocable device token. During
 * first-run only, the non-revocable bootstrap credential may authorize one
 * bounded setup session. That session is attached to an internal expiring,
 * revocable device row; neither the bootstrap secret nor the generated device
 * secret is retained by the browser.
 */
authRouter.post('/login', async (c) => {
  const ct = c.req.header('content-type') ?? ''
  let token: string | null = null

  if (ct.startsWith('application/json')) {
    const body = (await c.req.json().catch(() => null)) as { token?: unknown } | null
    if (body && typeof body.token === 'string') token = body.token
  } else {
    const form = await c.req.formData().catch(() => null)
    const v = form?.get('token')
    if (typeof v === 'string') token = v
  }

  const ctx = getCtx()
  const principal = token ? authenticateToken(token) : null
  let deviceTokenId = principal?.kind === 'device' ? principal.tokenId : null
  if (principal?.kind === 'bootstrap' && !isSetupComplete(ctx.db)) {
    deviceTokenId = webTokenRepo.create(ctx.db, 'first-run browser session', {
      expiresAt: Date.now() + webSessionRepo.SESSION_ABSOLUTE_MS,
    }).meta.id
  }
  if (!deviceTokenId) {
    if (ct.startsWith('application/json')) {
      return c.json({ error: 'invalid token' }, 401)
    }
    return c.redirect('/login?error=token', 302)
  }

  const created = webSessionRepo.create(ctx.db, deviceTokenId)
  const origin = resolvePublicOrigin()
  setCookie(c, origin.sessionCookie, created.cookieValue, {
    path: '/',
    httpOnly: true,
    secure: origin.production,
    sameSite: 'Strict',
    maxAge: 7 * 24 * 60 * 60,
  })
  setCookie(c, origin.csrfCookie, created.csrfToken, {
    path: '/',
    httpOnly: false,
    secure: origin.production,
    sameSite: 'Strict',
    maxAge: 7 * 24 * 60 * 60,
  })

  if (ct.startsWith('application/json')) {
    return c.json({ ok: true })
  }
  // Skip an avoidable redirect through the locked root on a fresh install.
  // Setup mutations seed the defaults synchronously, so completed installs
  // can still enter the workspace directly.
  return c.redirect(isSetupComplete(ctx.db) ? '/' : '/welcome', 302)
})

authRouter.post('/logout', (c) => {
  const principal = c.get('authPrincipal') as AuthenticatedOwnerResponse['principal']
  if (principal.kind !== 'session' || !principal.sessionId) {
    return c.json({ error: 'browser session required' }, 400)
  }
  webSessionRepo.revoke(getCtx().db, principal.sessionId)
  const origin = resolvePublicOrigin()
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
    return c.json({ error: 'session not found or already revoked' }, 409)
  }
  return c.body(null, 204)
})
