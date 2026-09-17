import { afterAll, beforeAll, expect, test } from 'vitest'
import { openDb, resolvePaths, webTokenRepo } from '../../daemon/src/core/index.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

// BAZ-055: per-device scopes over real HTTP. The scope→route decisions are
// unit-tested exhaustively in apps/daemon/test/lib/authz.test.ts; this suite
// pins the end-to-end behavior: enforcement in the middleware, structured 403s,
// scope validation at mint time, and bootstrap's implicit full access.

let server: TestServer

beforeAll(async () => {
  server = await startTestServer()
})

afterAll(async () => {
  await server.stop()
})

interface Minted {
  token: string
  id: string
}

function mintDirect(label: string, scopes: string[]): Minted {
  // Open the home DB on a second connection (the daemon holds one; SQLite is
  // multi-connection with WAL + 5s busy timeout).
  const paths = resolvePaths(server.home)
  const db = openDb(paths.db)
  try {
    const created = webTokenRepo.create(db, label, { scopes: scopes as never })
    return { token: created.token, id: created.meta.id }
  } finally {
    db.close()
  }
}

async function req(
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${server.url}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  return {
    status: res.status,
    json: (await res.json().catch(() => ({}))) as Record<string, unknown>,
  }
}

test('bootstrap token keeps full access: reads, writes, and token minting', async () => {
  const read = await req('GET', '/api/teams', server.token)
  expect(read.status).toBe(200)
  const mint = await req('POST', '/api/tokens', server.token, { label: 'via-bootstrap' })
  expect(mint.status).toBe(201)
  expect(mint.json.meta && (mint.json.meta as { scopes: string[] }).scopes).toEqual([
    'read',
    'write',
    'approvals',
    'admin',
  ])
})

test('read-only device token: reads pass, mutations and admin surfaces 403 with the required scope named', async () => {
  const { token } = mintDirect('read-only', ['read'])
  const ok = await req('GET', '/api/teams', token)
  expect(ok.status).toBe(200)

  const deniedWrite = await req('POST', '/api/teams', token, { name: 'nope' })
  expect(deniedWrite.status).toBe(403)
  expect(deniedWrite.json).toMatchObject({ code: 'insufficient_scope', requiredScope: 'write' })

  const deniedAdmin = await req('GET', '/api/config', token)
  expect(deniedAdmin.status).toBe(403)
  expect(deniedAdmin.json).toMatchObject({ code: 'insufficient_scope', requiredScope: 'admin' })

  const deniedApprovals = await req('POST', '/api/attention/acknowledge-all', token)
  expect(deniedApprovals.status).toBe(403)
  expect(deniedApprovals.json).toMatchObject({
    code: 'insufficient_scope',
    requiredScope: 'approvals',
  })
})

test('approvals-only device token: resolves gates, cannot read or write', async () => {
  const { token } = mintDirect('approvals-only', ['approvals'])
  const ack = await req('POST', '/api/attention/acknowledge-all', token)
  expect(ack.status).toBe(200)

  const deniedRead = await req('GET', '/api/teams', token)
  expect(deniedRead.status).toBe(403)
  expect(deniedRead.json).toMatchObject({ requiredScope: 'read' })

  const deniedChat = await req('POST', '/api/agents/whatever/chat', token, { message: 'hi' })
  expect(deniedChat.status).toBe(403)
  expect(deniedChat.json).toMatchObject({ requiredScope: 'write' })
})

test('admin-only device token: reaches admin surfaces and mints tokens, cannot read teams', async () => {
  const { token } = mintDirect('admin-only', ['admin'])
  const config = await req('GET', '/api/mcp-servers', token)
  expect(config.status).toBe(200)

  const mint = await req('POST', '/api/tokens', token, {
    label: 'from-admin',
    scopes: ['read'],
  })
  expect(mint.status).toBe(201)
  expect(mint.json.meta && (mint.json.meta as { scopes: string[] }).scopes).toEqual(['read'])

  const denied = await req('GET', '/api/teams', token)
  expect(denied.status).toBe(403)
  expect(denied.json).toMatchObject({ requiredScope: 'read' })
})

test('scope validation at mint time: unknown or empty scopes are rejected', async () => {
  const bad = await req('POST', '/api/tokens', server.token, {
    label: 'bad',
    scopes: ['root'],
  })
  expect(bad.status).toBe(400)
  const empty = await req('POST', '/api/tokens', server.token, { label: 'empty', scopes: [] })
  expect(empty.status).toBe(400)
})

test('session cookies inherit the device token scopes', async () => {
  const { token } = mintDirect('read-only-session', ['read'])
  const login = await fetch(`${server.url}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  expect(login.status).toBe(200)
  const setCookie = login.headers.get('set-cookie') ?? ''
  const sessionCookie = /bz_(?:session_dev|session)=[^;]+/.exec(setCookie)?.[0]
  if (!sessionCookie) throw new Error('login did not set a session cookie')

  // GET with the session cookie — no bearer — must be scope-checked too.
  const ok = await fetch(`${server.url}/api/teams`, { headers: { cookie: sessionCookie } })
  expect(ok.status).toBe(200)
})

test('401 handling is unchanged: garbage tokens still get credential_invalid', async () => {
  const res = await req('GET', '/api/teams', 'not-a-token')
  expect(res.status).toBe(401)
  expect(res.json).toMatchObject({ code: 'credential_invalid' })
})
