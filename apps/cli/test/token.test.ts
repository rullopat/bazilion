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
  expect(res.stdout).toMatch(/label: laptop/)
  expect(res.stdout).toMatch(/token: [0-9a-f]{48}/)
  expect(res.stdout).toMatch(/id: /)
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
    headers: { cookie: `bz_token=${token}` },
  })
  expect(res.status).toBe(200)
})

test('revoked tokens are rejected', async () => {
  const create = await server.cli(['token', 'create', 'burn'])
  const token = create.stdout.match(/token:\s+([0-9a-f]+)/)?.[1] as string
  const id = create.stdout.match(/id:\s+([\w-]+)/)?.[1] as string
  await server.cli(['token', 'revoke', id])

  const res = await fetch(`${server.url}/api/profiles`, {
    headers: { cookie: `bz_token=${token}` },
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
