// The web editor's USER.md save says what it started from: an Agent's write meanwhile is kept.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

let home: string
let oldHome: string | undefined

beforeEach(() => {
  oldHome = process.env.BAZILION_HOME
  home = mkdtempSync(join(tmpdir(), 'bazilion-user-md-route-'))
  process.env.BAZILION_HOME = home
  vi.resetModules()
})

afterEach(async () => {
  try {
    ;(await import('../../src/lib/ctx.ts')).getCtx().db.close()
  } catch {}
  if (oldHome === undefined) delete process.env.BAZILION_HOME
  else process.env.BAZILION_HOME = oldHome
  rmSync(home, { recursive: true, force: true })
  vi.resetModules()
})

test('a save from an editor that is behind an Agent is refused, and nothing changes', async () => {
  const { createApp } = await import('../../src/app.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const ctx = getCtx()
  const now = Date.now()
  // A chat model in use: the daemon answers nothing else until setup is done.
  ctx.db.raw.run(
    "INSERT INTO provider_state (provider_id, enabled, updated_at) VALUES ('lmstudio', 1, ?)",
    [now],
  )
  ctx.db.raw.run(
    "INSERT INTO provider_models (provider, model, added_at) VALUES ('lmstudio', 'qa', ?)",
    [now],
  )
  ctx.db.raw.run("INSERT INTO teams (id, name, created_at) VALUES ('team', 'Team', ?)", [now])
  const app = createApp()
  const headers = { authorization: `Bearer ${ctx.authToken}`, 'content-type': 'application/json' }
  const put = (body: object) =>
    app.request('/api/teams/team/user-md', { method: 'PUT', headers, body: JSON.stringify(body) })

  // A new Team's USER.md is empty.
  const userMd = async () =>
    ((await (await app.request('/api/teams/team', { headers })).json()) as { userMd: string })
      .userMd
  expect(await userMd()).toBe('')

  // The editor opened on the empty text; an Agent wrote meanwhile.
  expect((await put({ userMd: 'Name: Pat' })).status).toBe(200)
  const stale = await put({ userMd: 'Call me P.', expected: '' })
  expect(stale.status).toBe(409)
  expect(await stale.json()).toMatchObject({ code: 'user_md_changed' })
  expect(await userMd()).toBe('Name: Pat')

  // Starting from what is there, it saves; without `expected` (the CLI) it always does.
  expect((await put({ userMd: 'Name: Pat. Call me P.', expected: 'Name: Pat' })).status).toBe(200)
  expect((await put({ userMd: '' })).status).toBe(200)
})
