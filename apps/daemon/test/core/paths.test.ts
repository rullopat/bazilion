// T02 — canonical browser paths.
//
// The browser root must be derived from the canonical home and the Agent id,
// never from a worker-supplied path. It sits as a sibling of agents/teams,
// outside both.

import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { resolvePaths } from '../../src/core/paths.ts'

const homes: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'bazilion-paths-'))
  homes.push(d)
  return d
}

afterEach(() => {
  while (homes.length) rmSync(homes.pop() as string, { recursive: true, force: true })
})

test('browserDir is under the canonical home browsers root', () => {
  const home = tmp()
  const paths = resolvePaths(home)
  expect(paths.browsersDir).toBe(join(realpathSync(home), 'browsers'))
  expect(paths.browserDir('agent-1')).toBe(join(paths.browsersDir, 'agent-1'))
})

test('browser root is outside agents/ and teams/', () => {
  const paths = resolvePaths(tmp())
  expect(paths.browsersDir.startsWith(`${paths.agentsDir}/`)).toBe(false)
  expect(paths.browsersDir.startsWith(`${paths.teamsDir}/`)).toBe(false)
  expect(paths.agentDir('a').startsWith(`${paths.browsersDir}/`)).toBe(false)
})

test('a symlinked home resolves to its canonical form', () => {
  const real = tmp()
  const linkParent = tmp()
  const link = join(linkParent, 'home-link')
  symlinkSync(real, link, 'dir')
  const paths = resolvePaths(link)
  expect(paths.browsersDir).toBe(join(realpathSync(real), 'browsers'))
})
