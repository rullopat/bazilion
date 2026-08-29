import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const RAW_NATIVE_MISMATCH =
  "The module '/private/checkout/node_modules/better_sqlite3.node' was compiled against " +
  'a different Node.js version using NODE_MODULE_VERSION 141. This version of Node.js ' +
  'requires NODE_MODULE_VERSION 147.'

let home: string
let oldHome: string | undefined
let oldScheduler: string | undefined

beforeEach(() => {
  oldHome = process.env.BAZILION_HOME
  oldScheduler = process.env.BAZILION_SCHEDULER
  home = mkdtempSync(join(tmpdir(), 'bazilion-team-memory-errors-'))
  process.env.BAZILION_HOME = home
  process.env.BAZILION_SCHEDULER = 'off'
  vi.resetModules()
  vi.doMock('../../src/runtime/memory/qmd.ts', () => ({
    qmdBackend: () => ({
      init: async () => {
        throw new Error(RAW_NATIVE_MISMATCH)
      },
      read: async () => {
        throw new Error('unreachable')
      },
      write: async () => {
        throw new Error('unreachable')
      },
      search: async () => {
        throw new Error('unreachable')
      },
      list: async () => {
        throw new Error('unreachable')
      },
      remove: async () => {
        throw new Error('unreachable')
      },
    }),
  }))
})

afterEach(async () => {
  try {
    const { getCtx } = await import('../../src/lib/ctx.ts')
    getCtx().db.close()
  } catch {}
  if (oldHome === undefined) delete process.env.BAZILION_HOME
  else process.env.BAZILION_HOME = oldHome
  if (oldScheduler === undefined) delete process.env.BAZILION_SCHEDULER
  else process.env.BAZILION_SCHEDULER = oldScheduler
  rmSync(home, { recursive: true, force: true })
  vi.doUnmock('../../src/runtime/memory/qmd.ts')
  vi.resetModules()
})

test('Team memory reports native qmd failures as sanitized server errors', async () => {
  const { registerTeam } = await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const ctx = getCtx()
  registerTeam(ctx.db, { id: 'g' }, ctx.paths)
  const { teamsRouter } = await import('../../src/routes/teams.ts')

  const response = await teamsRouter.request('/g/memory')
  expect(response.status).toBe(500)
  const body = (await response.json()) as { error: string }
  expect(body.error).toMatch(
    /Bazilion memory could not load.*ABI 141.*requires ABI 147.*pnpm rebuild better-sqlite3/s,
  )
  expect(body.error).not.toContain('/private/checkout')
})

test('Team memory keeps missing Teams classified as not found', async () => {
  const { teamsRouter } = await import('../../src/routes/teams.ts')

  const response = await teamsRouter.request('/missing/memory')
  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({ error: 'team not found: missing' })
})
