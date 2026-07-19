import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { type Paths, resolvePaths } from '../../src/core/paths.ts'
import { refreshDefaultProfileTemplates } from '../../src/core/profile/seed.ts'
import { DEFAULT_AGENTS, DEFAULT_SOUL } from '../../src/core/profile/templates.ts'

let home: string
let paths: Paths
let dir: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'bazilion-refresh-'))
  paths = resolvePaths(home)
  dir = paths.profileDir('default')
  mkdirSync(dir, { recursive: true })
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

test('overwrites stale/edited default-profile files and adds missing ones', () => {
  writeFileSync(join(dir, 'SOUL.md'), '# old/edited soul\n')
  // AGENTS/TOOLS absent (the old default profile never had them).

  const written = refreshDefaultProfileTemplates(paths)

  // The five default-on files are brought to current.
  expect(written.sort()).toEqual([
    'AGENTS.md',
    'BOOTSTRAP.md',
    'IDENTITY.md',
    'SOUL.md',
    'TOOLS.md',
  ])
  expect(readFileSync(join(dir, 'SOUL.md'), 'utf8')).toBe(DEFAULT_SOUL)
  expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(DEFAULT_AGENTS)
})

test('is a no-op once the files already match the current defaults', () => {
  refreshDefaultProfileTemplates(paths)
  expect(refreshDefaultProfileTemplates(paths)).toEqual([])
})

test('no-ops when the default profile is not on disk', () => {
  rmSync(dir, { recursive: true, force: true })
  expect(refreshDefaultProfileTemplates(paths)).toEqual([])
})
