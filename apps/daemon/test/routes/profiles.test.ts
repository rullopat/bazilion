import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

let home: string
let originalHome: string | undefined
let originalScheduler: string | undefined

beforeEach(() => {
  originalHome = process.env.BAZILION_HOME
  originalScheduler = process.env.BAZILION_SCHEDULER
  home = mkdtempSync(join(tmpdir(), 'bazilion-profiles-route-test-'))
  process.env.BAZILION_HOME = home
  process.env.BAZILION_SCHEDULER = 'off'
  vi.resetModules()
})

afterEach(async () => {
  try {
    const { getCtx } = await import('../../src/lib/ctx.ts')
    getCtx().db.close()
  } catch {}
  if (originalHome === undefined) delete process.env.BAZILION_HOME
  else process.env.BAZILION_HOME = originalHome
  if (originalScheduler === undefined) delete process.env.BAZILION_SCHEDULER
  else process.env.BAZILION_SCHEDULER = originalScheduler
  rmSync(home, { recursive: true, force: true })
  vi.resetModules()
})

test('profile file GET and PUT reject HEARTBEAT.md', async () => {
  const { createProfile } = await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { profilesRouter } = await import('../../src/routes/profiles.ts')
  const ctx = getCtx()
  const profile = createProfile(ctx.db, ctx.paths, { id: 'profile', defaultModel: 'm' })

  const getResponse = await profilesRouter.request('/profile/files/HEARTBEAT.md')
  expect(getResponse.status).toBe(400)
  await expect(getResponse.json()).resolves.toEqual({ error: 'unsupported file: HEARTBEAT.md' })

  const putResponse = await profilesRouter.request('/profile/files/HEARTBEAT.md', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: '# must not be written\n' }),
  })
  expect(putResponse.status).toBe(400)
  await expect(putResponse.json()).resolves.toEqual({ error: 'unsupported file: HEARTBEAT.md' })
  expect(existsSync(join(profile.dir, 'HEARTBEAT.md'))).toBe(false)
})
