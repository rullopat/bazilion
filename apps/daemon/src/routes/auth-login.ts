// /api/auth/openai/* — ChatGPT OAuth provider connection state.
// /api/providers/test — model smoke-test.
// /api/login — token-based browser login (sets the bz_token cookie).

import { spawn } from 'node:child_process'
import type { ProviderTestRequest, ProviderTestResponse } from '@bazilion/api-types'
import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import { isSetupComplete, mergeSecretsIntoEnv, providerStateRepo } from '../core/index.ts'
import { isValidToken } from '../lib/auth.ts'
import { getCtx } from '../lib/ctx.ts'
import {
  clearOpenAICodexCredentials,
  createProviderRegistry,
  getOpenAICodexStatus,
  loadProviderConfigFromEnv,
  loginOpenAICodex,
  saveOpenAICodexLoginCredentials,
} from '../runtime/index.ts'

export const authRouter = new Hono()

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
authRouter.get('/auth/me', (c) => {
  const { db } = getCtx()
  return c.json({ authed: true, setupComplete: isSetupComplete(db) })
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
  try {
    const creds = await loginOpenAICodex({
      onAuth: ({ url }) => openBrowser(url),
      onPrompt: () =>
        Promise.reject(
          new Error(
            'interactive paste not supported in the web flow — cancel and try again, or use `bazilion auth openai login`',
          ),
        ),
      onProgress: () => {
        // single blocking POST keeps the UI simple
      },
    })
    saveOpenAICodexLoginCredentials(db, authToken, creds)
    return c.json(getOpenAICodexStatus(db, authToken))
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400)
  }
})

// ─── Provider model smoke-test ───────────────────────────────────────────

authRouter.post('/providers/test', async (c) => {
  const body = (await c.req.json().catch(() => null)) as ProviderTestRequest | null
  if (!body || typeof body.model !== 'string' || !body.model) {
    return c.json({ error: 'model is required' }, 400)
  }
  const message = typeof body.message === 'string' && body.message ? body.message : 'say hi briefly'
  const { db, paths, authToken } = getCtx()
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
    const out: ProviderTestResponse = { content: res.content, usage: res.usage }
    return c.json(out)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400)
  }
})

// ─── Browser login ───────────────────────────────────────────────────────

/**
 * Token-based login. Two body shapes accepted:
 *   - `application/json`: `{ token: "<value>" }` → returns `{ ok: true }` on
 *     success, sets the `bz_token` cookie. Used by clients (web pages, mobile)
 *     that prefer JSON.
 *   - `application/x-www-form-urlencoded`: `token=<value>` → 302 to `/` on
 *     success or `/login?error=1` on failure. Used by the legacy `<form>` on
 *     the Astro `/login` page; preserved for compatibility through Stage A.
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

  if (!token || !isValidToken(token)) {
    if (ct.startsWith('application/json')) {
      return c.json({ error: 'invalid token' }, 401)
    }
    return c.redirect('/login?error=1', 302)
  }

  setCookie(c, 'bz_token', token, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 30,
  })

  if (ct.startsWith('application/json')) {
    return c.json({ ok: true })
  }
  return c.redirect('/', 302)
})

/**
 * Open `url` in the host's default browser. Only called by the OAuth flow
 * triggered from /config — the user is on the same machine as the daemon in
 * that scenario (loopback-only `bazilion serve`).
 */
function openBrowser(url: string): void {
  const platform = process.platform
  const [cmd, ...args] =
    platform === 'darwin'
      ? ['open', url]
      : platform === 'win32'
        ? ['cmd', '/c', 'start', '""', url]
        : ['xdg-open', url]
  try {
    const child = spawn(cmd as string, args, { stdio: 'ignore', detached: true })
    child.unref()
    child.on('error', () => {
      // xdg-open missing on minimal installs — swallow so the flow still works
    })
  } catch {
    // spawn failed — user will still see the URL in the progress log
  }
}
