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
test('notification settings need authentication and start switched off', async () => {
  const { app, auth } = await fixture()
  expect((await app.request('/api/notifications')).status).toBe(401)
  const response = await app.request('/api/notifications', { headers: auth })
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toEqual({
    enabled: false,
    kinds: [
      'lesson_proposal',
      'review_failure',
      'trigger_failure',
      'agent_loop_break',
      'queue_interrupted',
    ],
    timezone: 'UTC',
    quietHours: null,
    telegramReady: false,
  })
})

test('settings save and read back; invalid ones are refused', async () => {
  const { app, auth } = await fixture()
  const put = (body: unknown) =>
    app.request('/api/notifications', { method: 'PUT', headers: auth, body: JSON.stringify(body) })
  const settings = {
    enabled: true,
    kinds: ['trigger_failure', 'review_failure'],
    timezone: 'Europe/Warsaw',
    quietHours: { start: '22:00', end: '07:00' },
  }
  const saved = await put(settings)
  expect(saved.status).toBe(200)
  // Kinds come back in their canonical order.
  expect(await saved.json()).toMatchObject({
    ...settings,
    kinds: ['review_failure', 'trigger_failure'],
  })
  for (const invalid of [
    { ...settings, timezone: 'Mars/Olympus' },
    { ...settings, kinds: [] },
    { ...settings, kinds: ['not_a_kind'] },
    { ...settings, quietHours: { start: '22:00', end: '22:00' } },
    { ...settings, enabled: 'yes' },
  ]) {
    const response = await put(invalid)
    expect(response.status).toBe(400)
    expect(await response.json()).toHaveProperty('error')
  }
  expect(await (await app.request('/api/notifications', { headers: auth })).json()).toMatchObject({
    timezone: 'Europe/Warsaw',
  })
  expect(
    (
      await app.request('/api/notifications', {
        method: 'PUT',
        headers: auth,
        body: 'x'.repeat(33 * 1024),
      })
    ).status,
  ).toBe(413)
})
