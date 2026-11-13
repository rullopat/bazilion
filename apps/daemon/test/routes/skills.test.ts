import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

let home: string
let oldHome: string | undefined

beforeEach(() => {
  oldHome = process.env.BAZILION_HOME
  home = mkdtempSync(join(tmpdir(), 'bazilion-skill-route-'))
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

test('DELETE /api/skills/:name removes an installed skill and nothing outside the library', async () => {
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { skillsRouter } = await import('../../src/routes/skills.ts')
  const { paths } = getCtx()
  const skill = join(paths.skillsDir, 'notes')
  mkdirSync(skill, { recursive: true })
  writeFileSync(join(skill, 'SKILL.md'), '---\nname: notes\ndescription: Notes\n---\nBody\n')
  // A directory beside the library, reachable as `../agents` from skills/.
  mkdirSync(join(paths.agentsDir, 'someone'), { recursive: true })

  // `../agents` and `../../<home>` (the whole home) both resolve outside skills/.
  for (const name of ['..%2Fagents', `..%2F..%2F${basename(home)}`, '..']) {
    const response = await skillsRouter.request(`/${name}`, { method: 'DELETE' })
    expect(response.status).toBe(404)
  }
  expect(existsSync(join(paths.agentsDir, 'someone'))).toBe(true)
  expect(existsSync(home)).toBe(true)

  expect((await skillsRouter.request('/notes', { method: 'DELETE' })).status).toBe(204)
  expect(existsSync(skill)).toBe(false)
  expect((await skillsRouter.request('/notes', { method: 'DELETE' })).status).toBe(404)
})
