import { afterAll, beforeAll, expect, test } from 'vitest'
import { webPairingTokenRepo, webTokenRepo } from '../../daemon/src/core/index.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

// BAZ-055 slices 2+3: one-paste pairing setup codes and the auth-posture probe.

let server: TestServer

beforeAll(async () => {
  server = await startTestServer()
})

afterAll(async () => {
  await server.stop()
})

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
}

test('the posture probe reports the auth gate, credential kinds, and setup state', async () => {
  const res = await fetch(`${server.url}/api/health`)
  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    ok: boolean
    auth: { required: boolean; credentialKinds: string[]; setupComplete: boolean }
  }
  expect(body.ok).toBe(true)
  expect(body.auth).toEqual({
    required: true,
    credentialKinds: ['bootstrap', 'device', 'pairing-code'],
    setupComplete: true,
  })
})

test('minting a pairing code: admin-gated, carries scopes, expires in 10 minutes', async () => {
  const denied = await fetch(`${server.url}/api/pair/codes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  expect(denied.status).toBe(401) // no credential at all

  const { token: readToken } = (await (async () => {
    // mint a read-only device token through the admin bootstrap
    const res = await fetch(`${server.url}/api/tokens`, {
      method: 'POST',
      headers: bearer(server.token),
      body: JSON.stringify({ label: 'pair-attempt', scopes: ['read'] }),
    })
    return res.json() as Promise<{ token: string }>
  })()) as { token: string }
  const forbidden = await fetch(`${server.url}/api/pair/codes`, {
    method: 'POST',
    headers: bearer(readToken),
    body: JSON.stringify({}),
  })
  expect(forbidden.status).toBe(403)

  const minted = await fetch(`${server.url}/api/pair/codes`, {
    method: 'POST',
    headers: bearer(server.token),
    body: JSON.stringify({ scopes: ['read'] }),
  })
  expect(minted.status).toBe(201)
  const body = (await minted.json()) as {
    code: string
    meta: { scopes: string[]; createdAt: number; expiresAt: number }
    setupUrl: string
  }
  expect(body.meta.scopes).toEqual(['read'])
  expect(body.setupUrl).toMatch(/^bazilion-pair:\/\/pair\?server=.*&code=/)
  expect(body.meta.expiresAt - body.meta.createdAt).toBe(10 * 60_000)
})

test('exchange: the code mints exactly one scoped credential, then is inert', async () => {
  const mint = await fetch(`${server.url}/api/pair/codes`, {
    method: 'POST',
    headers: bearer(server.token),
    body: JSON.stringify({ scopes: ['approvals'] }),
  })
  const { code } = (await mint.json()) as { code: string }

  // Public path: no bearer — the code is the secret.
  const first = await fetch(`${server.url}/api/pair/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  expect(first.status).toBe(201)
  const minted = (await first.json()) as { token: string; meta: { scopes: string[] } }
  expect(minted.meta.scopes).toEqual(['approvals'])

  // The minted credential works and has exactly the granted scope.
  const ok = await fetch(`${server.url}/api/attention/acknowledge-all`, {
    method: 'POST',
    headers: { authorization: `Bearer ${minted.token}` },
  })
  expect(ok.status).toBe(200)
  const denied = await fetch(`${server.url}/api/teams`, {
    headers: { authorization: `Bearer ${minted.token}` },
  })
  expect(denied.status).toBe(403)

  // Second exchange of the same code: refused.
  const second = await fetch(`${server.url}/api/pair/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  expect(second.status).toBe(400)
  expect(((await second.json()) as { error: string }).error).toContain('used')
})

test('exchange rejects invalid codes with the reason', async () => {
  const bad = await fetch(`${server.url}/api/pair/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'deadbeef' }),
  })
  expect(bad.status).toBe(400)
  expect(((await bad.json()) as { error: string }).error).toContain('invalid')
})

test('an expired code cannot be exchanged', async () => {
  // Mint directly through the repo on a second DB connection, then force it
  // expired by rewinding its expiry.
  const {
    openDb,
    resolvePaths,
    webTokenRepo: _webTokenRepo,
  } = await import('../../daemon/src/core/index.ts')
  void _webTokenRepo
  const paths = resolvePaths(server.home)
  const db = openDb(paths.db)
  try {
    const created = webPairingTokenRepo.create(db, { scopes: ['read'] })
    db.raw.run('UPDATE web_pairing_tokens SET expires_at = ? WHERE id = ?', [
      Date.now() - 1,
      created.meta.id,
    ])
    const expired = await fetch(`${server.url}/api/pair/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: created.code }),
    })
    expect(expired.status).toBe(400)
    expect(((await expired.json()) as { error: string }).error).toContain('expired')
  } finally {
    db.close()
  }
})
