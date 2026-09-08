import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

let home: string
let oldHome: string | undefined
let oldScheduler: string | undefined

beforeEach(() => {
  oldHome = process.env.BAZILION_HOME
  oldScheduler = process.env.BAZILION_SCHEDULER
  home = mkdtempSync(join(tmpdir(), 'bazilion-notification-route-'))
  process.env.BAZILION_HOME = home
  process.env.BAZILION_SCHEDULER = 'off'
  vi.resetModules()
})

afterEach(async () => {
  try {
    ;(await import('../../src/lib/ctx.ts')).getCtx().db.close()
  } catch {}
  if (oldHome === undefined) delete process.env.BAZILION_HOME
  else process.env.BAZILION_HOME = oldHome
  if (oldScheduler === undefined) delete process.env.BAZILION_SCHEDULER
  else process.env.BAZILION_SCHEDULER = oldScheduler
  rmSync(home, { recursive: true, force: true })
  vi.resetModules()
})

async function fixture() {
  const { createApp } = await import('../../src/app.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const ctx = getCtx()
  ctx.db.raw.run(
    "INSERT INTO provider_state (provider_id, enabled, updated_at) VALUES ('lmstudio', 1, 1)",
  )
  ctx.db.raw.run(
    "INSERT INTO provider_models (provider, model, added_at) VALUES ('lmstudio', 'qa', 1)",
  )
  return {
    app: createApp(),
    auth: { authorization: `Bearer ${ctx.authToken}`, 'content-type': 'application/json' },
  }
}
test('notification management requires authentication and returns default-off no-store state', async () => {
  const { app, auth } = await fixture()
  for (const path of ['/api/notifications', '/api/notifications/receipts'])
    expect((await app.request(path)).status).toBe(401)
  const response = await app.request('/api/notifications', { headers: auth })
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toMatchObject({
    settings: { enabled: false, restorePaused: false },
    readiness: { ready: false },
  })
  expect(
    (await app.request('/api/notifications/receipts?limit=101', { headers: auth })).status,
  ).toBe(400)
})
test('invalid settings and unavailable destinations do not enable notifications or leak errors', async () => {
  const { app, auth } = await fixture()
  const input = {
    expectedRevision: 0,
    enabled: true,
    kinds: ['review_failure'],
    timezone: 'UTC',
    quietHours: null,
    destinationId: 'a'.repeat(64),
  }
  const response = await app.request('/api/notifications', {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify(input),
  })
  expect(response.status).toBe(409)
  expect(await response.json()).toEqual({
    error: 'notification_destination_unavailable',
    code: 'notification_destination_unavailable',
  })
  expect(
    (
      await app.request('/api/notifications', {
        method: 'PUT',
        headers: auth,
        body: JSON.stringify({ ...input, unexpected: '/home/private' }),
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await app.request('/api/notifications/preview', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ kinds: ['review_failure'] }),
      })
    ).status,
  ).toBe(409)
  const saved = await app.request('/api/notifications', {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ ...input, enabled: false }),
  })
  expect(saved.status).toBe(200)
  expect(await saved.json()).toMatchObject({ enabled: false, revision: 1 })
})
test('mutation body bounds and explicit retry acknowledgement are enforced before delivery', async () => {
  const { app, auth } = await fixture()
  expect(
    (
      await app.request('/api/notifications', {
        method: 'PUT',
        headers: auth,
        body: 'x'.repeat(33 * 1024),
      })
    ).status,
  ).toBe(413)
  expect(
    (
      await app.request('/api/notifications/receipts/missing/retry', {
        method: 'POST',
        headers: auth,
        body: '{}',
      })
    ).status,
  ).toBe(400)
})
