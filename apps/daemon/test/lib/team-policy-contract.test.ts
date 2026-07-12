import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

let home: string
let oldHome: string | undefined
let oldGate: string | undefined
let oldScheduler: string | undefined

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'bazilion-team-team-policy-contract-'))
  oldHome = process.env.BAZILION_HOME
  oldGate = process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
  oldScheduler = process.env.BAZILION_SCHEDULER
  process.env.BAZILION_HOME = home
  process.env.BAZILION_SCHEDULER = 'off'
  vi.resetModules()
})

afterEach(() => {
  if (oldHome === undefined) delete process.env.BAZILION_HOME
  else process.env.BAZILION_HOME = oldHome
  if (oldGate === undefined) delete process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
  else process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = oldGate
  if (oldScheduler === undefined) delete process.env.BAZILION_SCHEDULER
  else process.env.BAZILION_SCHEDULER = oldScheduler
  rmSync(home, { recursive: true, force: true })
  vi.resetModules()
})

test('daemon bootstrap accepts enforcement-on after management contract version 1', async () => {
  process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const ctx = getCtx()
  expect(ctx.db).toBeDefined()
  ctx.db.close()
})

test('daemon bootstrap remains available with the default-off gate', async () => {
  delete process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const ctx = getCtx()
  expect(ctx.db).toBeDefined()
  ctx.db.close()
})
