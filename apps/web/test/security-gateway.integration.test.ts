import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import {
  createServer,
  type IncomingMessage,
  request as httpRequest,
  type ServerResponse,
} from 'node:http'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  findFreePort,
  startTestServer,
  type TestServer,
} from '../../cli/test/server-fixture.ts'

const root = join(import.meta.dirname, '..', '..', '..')
const webDist = join(root, 'apps', 'web', 'dist')
interface RunningWeb {
  process: ChildProcess
  url: string
  origin: string
  stop(): Promise<void>
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (await check()) return
    } catch (error) {
      if ((error as Error).message.startsWith('web gateway exited:')) throw error
      // Listener is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('timed out waiting for the production web gateway')
}

async function startWeb(
  daemonUrl: string,
  options: { port?: number; origin?: string } = {},
): Promise<RunningWeb> {
  const port = options.port ?? (await findFreePort())
  const url = `http://127.0.0.1:${port}`
  const origin = options.origin ?? `https://127.0.0.1:${port}`
  let diagnostics = ''
  const process = spawn(
    'node',
    ['--import', 'tsx/esm', join(root, 'apps', 'cli', 'src', 'web-server.ts')],
    {
      env: {
        ...globalThis.process.env,
        BAZILION_DAEMON: daemonUrl,
        BAZILION_PUBLIC_ORIGIN: origin,
        BAZILION_WEB_DIST: webDist,
        WEB_HOST: '127.0.0.1',
        WEB_PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  process.stdout?.on('data', (chunk) => {
    diagnostics += String(chunk)
  })
  process.stderr?.on('data', (chunk) => {
    diagnostics += String(chunk)
  })
  try {
    await waitFor(async () => {
      if (process.exitCode !== null) throw new Error(`web gateway exited: ${diagnostics}`)
      const response = await fetch(`${url}/api/health`)
      if (response.status !== 200) {
        diagnostics += `probe ${response.status}: ${await response.text()}\n`
      }
      return response.status === 200
    })
  } catch (error) {
    process.kill('SIGKILL')
    throw new Error(`${(error as Error).message}\n${diagnostics}`)
  }
  return {
    process,
    url,
    origin,
    stop: () =>
      new Promise((resolve) => {
        if (process.exitCode !== null) return resolve()
        process.once('close', () => resolve())
        process.kill('SIGTERM')
        setTimeout(() => process.exitCode === null && process.kill('SIGKILL'), 5_000).unref()
      }),
  }
}

function request(
  web: RunningWeb,
  path: string,
  init: RequestInit = {},
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${web.url}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  })
}

function rawRequest(
  web: RunningWeb,
  path: string,
  options: { method: string; headers: Record<string, string>; body?: string },
): Promise<Response> {
  const target = new URL(web.url)
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path,
        method: options.method,
        headers: options.headers,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const headers = new Headers()
          for (const [name, value] of Object.entries(res.headers)) {
            for (const item of Array.isArray(value) ? value : value ? [value] : []) {
              headers.append(name, String(item))
            }
          }
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 500,
              headers,
            }),
          )
        })
      },
    )
    req.on('error', reject)
    req.end(options.body)
  })
}

function cookieValue(setCookies: string[], name: string): string {
  const value = new RegExp(`(?:^|\\s)${name}=([^;]+)`).exec(setCookies.join('\n'))?.[1]
  if (!value) throw new Error(`missing ${name} cookie`)
  return value
}

let daemon: TestServer
let web: RunningWeb

beforeAll(async () => {
  if (process.env.BAZILION_SECURITY_ACCEPTANCE !== '1') {
    execFileSync('pnpm', ['--filter', '@bazilion/web', 'build'], { cwd: root, stdio: 'inherit' })
  }
  const port = await findFreePort()
  const origin = `https://127.0.0.1:${port}`
  daemon = await startTestServer({ BAZILION_PUBLIC_ORIGIN: origin })
  web = await startWeb(daemon.url, { port, origin })
}, 60_000)

afterAll(async () => {
  await web?.stop()
  await daemon?.stop()
})

test('production gateway rejects hostile authority before side effects and enforces bound browser sessions', async () => {
  const created = await daemon.cli(['token', 'create', 'gateway-browser'])
  const deviceSecret = created.stdout.match(/token:\s+([0-9a-f]+)/)?.[1]
  expect(deviceSecret).toBeTruthy()

  const loginBody = JSON.stringify({ token: deviceSecret })
  const bootstrapLogin = await request(
    web,
    '/api/login',
    { method: 'POST', body: JSON.stringify({ token: daemon.token }) },
    { origin: web.origin, 'content-type': 'application/json' },
  )
  expect(bootstrapLogin.status).toBe(401)
  const hostile = [
    rawRequest(web, '/api/login', {
      method: 'POST',
      body: loginBody,
      headers: {
        host: 'attacker.invalid',
        origin: web.origin,
        'content-type': 'application/json',
      },
    }),
    request(web, '/api/login', { method: 'POST', body: loginBody }, {
      origin: 'https://attacker.invalid',
      'content-type': 'application/json',
    }),
    request(web, '/api/login', { method: 'POST', body: loginBody }, {
      origin: web.origin,
      forwarded: 'host=attacker.invalid;proto=https',
      'content-type': 'application/json',
    }),
    request(web, '/api/login', { method: 'POST', body: loginBody }, {
      origin: web.origin,
      'x-forwarded-host': 'attacker.invalid',
      'content-type': 'application/json',
    }),
    request(web, '/api/login', { method: 'POST', body: loginBody }, {
      origin: web.origin,
      'x-forwarded-proto': 'http',
      'content-type': 'application/json',
    }),
  ]
  expect((await Promise.all(hostile)).map((response) => response.status)).toEqual([
    404, 403, 400, 400, 400,
  ])
  const noSessions = await fetch(`${daemon.url}/api/sessions`, {
    headers: { authorization: `Bearer ${daemon.token}` },
  })
  expect(await noSessions.json()).toEqual({ sessions: [] })

  const login = await request(web, '/api/login', { method: 'POST', body: loginBody }, {
    origin: web.origin,
    'content-type': 'application/json',
  })
  expect(login.status).toBe(200)
  const setCookies = login.headers.getSetCookie()
  const serializedCookies = setCookies.join('\n')
  expect(serializedCookies).not.toContain(deviceSecret)
  const sessionCookie = setCookies.find((value) => value.startsWith('__Host-bz_session=')) ?? ''
  const csrfCookie = setCookies.find((value) => value.startsWith('__Host-bz_csrf=')) ?? ''
  for (const attribute of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict']) {
    expect(sessionCookie).toContain(attribute)
  }
  for (const attribute of ['Path=/', 'Secure', 'SameSite=Strict']) {
    expect(csrfCookie).toContain(attribute)
  }
  expect(csrfCookie).not.toContain('HttpOnly')
  const session = cookieValue(setCookies, '__Host-bz_session')
  const csrf = cookieValue(setCookies, '__Host-bz_csrf')
  const cookies = `__Host-bz_session=${session}; __Host-bz_csrf=${csrf}`
  const duplicate = await rawRequest(web, '/api/auth/whoami', {
    method: 'GET',
    headers: {
      host: new URL(web.url).host,
      cookie: `__Host-bz_session=attacker-fixed; __Host-bz_session=${session}; __Host-bz_csrf=${csrf}`,
    },
  })
  expect(duplicate.status).toBe(400)

  const missingCsrf = await request(web, '/api/logout', { method: 'POST' }, {
    origin: web.origin,
    cookie: cookies,
  })
  expect(missingCsrf.status).toBe(403)
  const stillActive = await request(web, '/api/auth/whoami', {}, { cookie: cookies })
  expect(stillActive.status).toBe(200)

  const secondLogin = await request(web, '/api/login', { method: 'POST', body: loginBody }, {
    origin: web.origin,
    'content-type': 'application/json',
  })
  const secondCsrf = cookieValue(secondLogin.headers.getSetCookie(), '__Host-bz_csrf')
  const crossSession = await request(web, '/api/logout', { method: 'POST' }, {
    origin: web.origin,
    cookie: `__Host-bz_session=${session}; __Host-bz_csrf=${secondCsrf}`,
    'x-bazilion-csrf': secondCsrf,
  })
  expect(crossSession.status).toBe(403)
  expect((await request(web, '/api/auth/whoami', {}, { cookie: cookies })).status).toBe(200)

  const logout = await request(web, '/api/logout', { method: 'POST' }, {
    origin: web.origin,
    cookie: cookies,
    'x-bazilion-csrf': csrf,
  })
  expect(logout.status).toBe(200)
  expect((await request(web, '/api/auth/whoami', {}, { cookie: cookies })).status).toBe(401)

  const bearer = await request(web, '/api/auth/whoami', {}, {
    authorization: `Bearer ${deviceSecret}`,
  })
  expect(bearer.status).toBe(200)
  expect(await bearer.json()).toMatchObject({ principal: { kind: 'device' } })
  expect(bearer.headers.getSetCookie()).toEqual([])
})

test('production gateway enforces device revocation and both session deadlines without cross-device fallout', async () => {
  async function login(label: string) {
    const created = await daemon.cli(['token', 'create', label])
    const token = created.stdout.match(/token:\s+([0-9a-f]+)/)?.[1] as string
    const response = await request(
      web,
      '/api/login',
      { method: 'POST', body: JSON.stringify({ token }) },
      { origin: web.origin, 'content-type': 'application/json' },
    )
    const setCookies = response.headers.getSetCookie()
    return {
      token,
      cookie: `__Host-bz_session=${cookieValue(setCookies, '__Host-bz_session')}; __Host-bz_csrf=${cookieValue(setCookies, '__Host-bz_csrf')}`,
    }
  }

  const revoked = await login('revoked-device')
  const unaffected = await login('unrelated-device')
  const tokenList = (await (
    await fetch(`${daemon.url}/api/tokens`, {
      headers: { authorization: `Bearer ${daemon.token}` },
    })
  ).json()) as { tokens: Array<{ id: string; label: string }> }
  const revokedId = tokenList.tokens.find((token) => token.label === 'revoked-device')?.id
  expect(revokedId).toBeTruthy()
  expect((await daemon.cli(['token', 'revoke', revokedId as string])).exitCode).toBe(0)
  expect((await request(web, '/api/auth/whoami', {}, { cookie: revoked.cookie })).status).toBe(401)
  expect((await request(web, '/api/auth/whoami', {}, { cookie: unaffected.cookie })).status).toBe(200)

  const idle = await login('idle-expiry')
  const absolute = await login('absolute-expiry')
  const paths = (await import('../../daemon/src/core/paths.ts')).resolvePaths(daemon.home)
  const { openDb } = await import('../../daemon/src/core/db/client.ts')
  const db = openDb(paths.db)
  const sessions = db.raw
    .query<{ id: string; device_label: string }, []>(
      `SELECT s.id, t.label AS device_label FROM web_sessions s
       JOIN web_tokens t ON t.id = s.device_token_id`,
    )
    .all()
  const idleId = sessions.find((session) => session.device_label === 'idle-expiry')?.id
  const absoluteId = sessions.find((session) => session.device_label === 'absolute-expiry')?.id
  db.raw.run('UPDATE web_sessions SET idle_expires_at = 0 WHERE id = ?', [idleId])
  db.raw.run('UPDATE web_sessions SET absolute_expires_at = 0 WHERE id = ?', [absoluteId])
  db.close()
  expect((await request(web, '/api/auth/whoami', {}, { cookie: idle.cookie })).status).toBe(401)
  expect((await request(web, '/api/auth/whoami', {}, { cookie: absolute.cookie })).status).toBe(401)
})

test('production gateway applies security headers and bounds request bodies', async () => {
  const health = await request(web, '/api/health')
  expect(health.status).toBe(200)
  expect(health.headers.get('strict-transport-security')).toContain('max-age=31536000')
  expect(health.headers.get('x-content-type-options')).toBe('nosniff')
  expect(health.headers.get('x-frame-options')).toBe('DENY')
  expect(health.headers.get('content-security-policy')).toContain("font-src 'self'")
  expect(health.headers.get('content-security-policy')).not.toMatch(/https?:\/\/(?!security)/)

  const html = await request(web, '/')
  expect(html.status).toBe(200)
  expect(html.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
  const body = await html.text()
  expect(body).not.toContain('fonts.googleapis.com')
  expect(body).not.toContain('fonts.gstatic.com')

  const oversized = await request(
    web,
    '/api/login',
    { method: 'POST', body: JSON.stringify({ padding: 'x'.repeat(2 * 1024 * 1024) }) },
    { origin: web.origin, 'content-type': 'application/json' },
  )
  expect(oversized.status).toBe(413)

  const backup = await request(web, '/api/backup', {}, {
    authorization: `Bearer ${daemon.token}`,
  })
  expect(backup.status).toBe(200)
  expect(backup.headers.get('content-type')).toContain('application/gzip')
  expect((await backup.arrayBuffer()).byteLength).toBeGreaterThan(100)
})

interface FakeUpstream {
  url: string
  seen: Array<{ path: string; headers: IncomingMessage['headers']; bytes: number }>
  releaseStream(): void
  stop(): Promise<void>
}

async function startFakeUpstream(): Promise<FakeUpstream> {
  const seen: FakeUpstream['seen'] = []
  let release = () => {}
  const streamBarrier = new Promise<void>((resolve) => {
    release = resolve
  })
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', async () => {
      seen.push({ path: req.url ?? '', headers: req.headers, bytes: Buffer.concat(chunks).byteLength })
      if (req.url === '/api/stream') {
        res.writeHead(200, { 'content-type': 'application/x-ndjson' })
        res.write(`${JSON.stringify({ kind: 'event', value: 1 })}\n`)
        await streamBarrier
        res.end(`${JSON.stringify({ kind: 'done' })}\n`)
        return
      }
      if (req.url === '/api/download') {
        res.writeHead(200, { 'content-type': 'application/octet-stream' })
        res.end('download-proof')
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ bytes: Buffer.concat(chunks).byteLength }))
    })
  })
  const port = await findFreePort()
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    releaseStream: release,
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

test('production gateway preserves streaming, downloads, and uploads while stripping client forwarding identity', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startWeb(upstream.url)
  try {
    const streamed = await request(proxy, '/api/stream', {}, {
      authorization: 'Bearer native-fixture',
      'x-forwarded-host': new URL(proxy.origin).host,
      'x-forwarded-proto': 'https',
      'x-real-ip': '203.0.113.9',
    })
    expect(streamed.status).toBe(200)
    const reader = streamed.body?.getReader()
    expect(reader).toBeTruthy()
    const first = await reader!.read()
    expect(new TextDecoder().decode(first.value)).toContain('"kind":"event"')
    upstream.releaseStream()
    const second = await reader!.read()
    expect(new TextDecoder().decode(second.value)).toContain('"kind":"done"')

    const download = await request(proxy, '/api/download', {}, {
      authorization: 'Bearer native-fixture',
    })
    expect(await download.text()).toBe('download-proof')

    const form = new FormData()
    form.set('attachment', new Blob(['upload-proof']), 'proof.txt')
    const upload = await request(proxy, '/api/upload', { method: 'POST', body: form }, {
      authorization: 'Bearer native-fixture',
    })
    expect(upload.status).toBe(200)
    expect((await upload.json()) as { bytes: number }).toMatchObject({ bytes: expect.any(Number) })

    for (const observed of upstream.seen) {
      expect(observed.headers.forwarded).toBeUndefined()
      expect(observed.headers['x-forwarded-host']).toBeUndefined()
      expect(observed.headers['x-forwarded-proto']).toBeUndefined()
      expect(observed.headers['x-real-ip']).toBeUndefined()
      expect(observed.headers.host).toBe(new URL(upstream.url).host)
    }
    expect(upstream.seen.find((entry) => entry.path === '/api/upload')?.bytes).toBeGreaterThan(0)
  } finally {
    await proxy.stop()
    await upstream.stop()
  }
}, 30_000)
