import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { startTestServer, type TestServer } from './server-fixture.ts'

let server: TestServer

beforeAll(async () => {
  server = await startTestServer()
})

afterAll(async () => {
  await server.stop()
})
beforeEach(() => server.reset())

test('token show-local prints the bootstrap token from auth.json', async () => {
  const raw = readFileSync(join(server.home, 'auth.json'), 'utf8')
  const expected = JSON.parse(raw).token as string
  expect(typeof expected).toBe('string')

  const res = await server.cli(['token', 'show-local'])
  expect(res.exitCode).toBe(0)
  expect(res.stdout.trim()).toBe(expected)
})

test('token create mints a token and prints the plaintext exactly once', async () => {
  const res = await server.cli(['token', 'create', 'laptop'])
  expect(res.exitCode).toBe(0)
  expect(res.stdout).toMatch(/label:\s+laptop/)
  expect(res.stdout).toMatch(/token: [0-9a-f]{48}/)
  expect(res.stdout).toMatch(/id: /)
  // No expiry unless asked for.
  expect(res.stdout).toContain('expires: (never)')

  const expiring = await server.cli(['token', 'create', 'phone', '--expires-days', '30'])
  expect(expiring.exitCode).toBe(0)
  const expires = Date.parse(expiring.stdout.match(/expires: (\S+)/)?.[1] ?? '')
  expect(expires - Date.now()).toBeGreaterThan(29 * 86_400_000)
  expect(expires - Date.now()).toBeLessThanOrEqual(30 * 86_400_000)
  const invalid = await server.cli(['token', 'create', 'bad', '--expires-days', '0'])
  expect(invalid.exitCode).not.toBe(0)
})

test('token list shows active tokens and hides revoked by default', async () => {
  const createA = await server.cli(['token', 'create', 'alpha'])
  const idA = createA.stdout.match(/id:\s+([\w-]+)/)?.[1] as string
  await server.cli(['token', 'create', 'beta'])
  const revoke = await server.cli(['token', 'revoke', idA])
  expect(revoke.exitCode).toBe(0)

  const activeList = await server.cli(['token', 'list'])
  expect(activeList.stdout).not.toContain(idA)
  expect(activeList.stdout).toContain('beta')

  const allList = await server.cli(['token', 'list', '--all'])
  expect(allList.stdout).toContain(idA)
  expect(allList.stdout).toContain('revoked')
})

test('a minted token authenticates subsequent API calls', async () => {
  const create = await server.cli(['token', 'create', 'laptop'])
  const token = create.stdout.match(/token:\s+([0-9a-f]+)/)?.[1] as string
  expect(token).toBeTruthy()

  const res = await fetch(`${server.url}/api/profiles`, {
    headers: { authorization: `Bearer ${token}` },
  })
  expect(res.status).toBe(200)
})

test('the bootstrap token cannot be revoked', async () => {
  const list = await fetch(`${server.url}/api/tokens`, {
    headers: { authorization: `Bearer ${server.token}` },
  })
  const { tokens } = (await list.json()) as { tokens: { id: string; kind: string }[] }
  const bootstrap = tokens.find((token) => token.kind === 'bootstrap')
  expect(bootstrap).toBeDefined()

  const revoke = await server.cli(['token', 'revoke', bootstrap?.id as string])
  expect(revoke.exitCode).toBe(3)
  expect(revoke.stderr).toContain('cannot revoke the bootstrap token')
  const res = await fetch(`${server.url}/api/profiles`, {
    headers: { authorization: `Bearer ${server.token}` },
  })
  expect(res.status).toBe(200)
})

test('revoked tokens are rejected', async () => {
  const create = await server.cli(['token', 'create', 'burn'])
  const token = create.stdout.match(/token:\s+([0-9a-f]+)/)?.[1] as string
  const id = create.stdout.match(/id:\s+([\w-]+)/)?.[1] as string
  await server.cli(['token', 'revoke', id])

  const res = await fetch(`${server.url}/api/profiles`, {
    headers: { authorization: `Bearer ${token}` },
  })
  expect(res.status).toBe(401)
})

test('login --server --token verifies and writes remote to auth.json', async () => {
  const create = await server.cli(['token', 'create', 'remote'])
  const token = create.stdout.match(/token:\s+([0-9a-f]+)/)?.[1] as string

  // login runs against `server.home` — bypass the env-var short-circuit by
  // not setting BAZILION_SERVER/TOKEN for this specific invocation.
  const login = await server.cli(['login', '--server', server.url, '--token', token], {
    BAZILION_SERVER: '',
    BAZILION_TOKEN: '',
  })
  expect(login.exitCode).toBe(0)
  expect(login.stdout).toMatch(/saved remote/)

  const configPath = join(server.home, 'auth.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    remote?: { server: string; token: string }
  }
  expect(config.remote?.server).toBe(server.url)
  expect(config.remote?.token).toBe(token)
})

test('login --clear removes the stored remote', async () => {
  const configPath = join(server.home, 'auth.json')
  const existing = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>
  existing.remote = { server: 'http://example.invalid', token: 'abc' }
  writeFileSync(configPath, `${JSON.stringify(existing, null, 2)}\n`)

  const clear = await server.cli(
    ['login', '--server', 'http://example.invalid', '--token', 'x', '--clear'],
    { BAZILION_SERVER: '', BAZILION_TOKEN: '' },
  )
  expect(clear.exitCode).toBe(0)

  const after = JSON.parse(readFileSync(configPath, 'utf8')) as { remote?: unknown }
  expect(after.remote).toBeUndefined()
})

test('public health is liveness only; detailed health requires authentication', async () => {
  const publicResponse = await fetch(`${server.url}/api/health`)
  expect(await publicResponse.json()).toEqual({ ok: true })
  expect(await fetch(`${server.url}/api/health/details`)).toHaveProperty('status', 401)
  const detailed = await fetch(`${server.url}/api/health/details`, {
    headers: { authorization: `Bearer ${server.token}` },
  })
  expect(detailed.status).toBe(200)
})

test('browser login exchanges the bootstrap or a device token for session cookies', async () => {
  const bootstrapLogin = await fetch(`${server.url}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: server.token }),
  })
  expect(bootstrapLogin.status).toBe(200)
  expect(bootstrapLogin.headers.getSetCookie().join('\n')).not.toContain(server.token)
  const rejected = await fetch(`${server.url}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'not-a-token' }),
  })
  expect(rejected.status).toBe(401)

  const create = await server.cli(['token', 'create', 'browser'])
  const token = create.stdout.match(/token:\s+([0-9a-f]+)/)?.[1] as string
  const login = await fetch(`${server.url}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  expect(login.status).toBe(200)
  const setCookies = login.headers.getSetCookie()
  const session = /bz_session_dev=([^;]+)/.exec(setCookies.join('\n'))?.[1]
  const csrf = /bz_csrf_dev=([^;]+)/.exec(setCookies.join('\n'))?.[1]
  expect(session).toBeTruthy()
  expect(csrf).toBeTruthy()
  expect(setCookies.join('\n')).not.toContain(token)

  const cookies = `bz_session_dev=${session}; bz_csrf_dev=${csrf}`
  const whoami = await fetch(`${server.url}/api/auth/whoami`, { headers: { cookie: cookies } })
  expect(whoami.status).toBe(200)
  expect(await whoami.json()).toMatchObject({
    authenticated: true,
    principal: { kind: 'session', label: 'browser' },
  })
  const missingCsrf = await fetch(`${server.url}/api/logout`, {
    method: 'POST',
    headers: { cookie: cookies },
  })
  expect(missingCsrf.status).toBe(403)
  const logout = await fetch(`${server.url}/api/logout`, {
    method: 'POST',
    headers: { cookie: cookies, 'x-bazilion-csrf': csrf as string },
  })
  expect(logout.status).toBe(200)
  expect(
    await fetch(`${server.url}/api/auth/whoami`, { headers: { cookie: cookies } }),
  ).toHaveProperty('status', 401)
})
