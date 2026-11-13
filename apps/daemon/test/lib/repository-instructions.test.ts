import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { loadRepositoryInstructions } from '../../src/lib/repository-instructions.ts'

// One-shot hooks run around the loader's stat (the check) and after fstat (the open descriptor).
const hooks = vi.hoisted(() => ({
  beforeStat: undefined as (() => void) | undefined,
  afterStat: undefined as (() => void) | undefined,
  afterFstat: undefined as (() => void) | undefined,
}))
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  const run = (name: keyof typeof hooks) => {
    const hook = hooks[name]
    hooks[name] = undefined
    hook?.()
  }
  return {
    ...fs,
    statSync: (...args: Parameters<typeof fs.statSync>) => {
      run('beforeStat')
      const stat = fs.statSync(...args)
      run('afterStat')
      return stat
    },
    fstatSync: (...args: Parameters<typeof fs.fstatSync>) => {
      const stat = fs.fstatSync(...args)
      run('afterFstat')
      return stat
    },
  }
})

let parent: string
let root: string
beforeEach(() => {
  parent = mkdtempSync(join(tmpdir(), 'bazilion-instructions-'))
  root = join(parent, 'team')
  mkdirSync(join(root, 'apps', 'web', 'src'), { recursive: true })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  hooks.beforeStat = undefined
  hooks.afterStat = undefined
  hooks.afterFstat = undefined
  vi.restoreAllMocks()
  rmSync(parent, { recursive: true, force: true })
})

test('reads AGENTS.md from the root down to the working directory, nothing beside or below', () => {
  writeFileSync(join(root, 'AGENTS.md'), 'ROOT')
  writeFileSync(join(root, 'apps', 'web', 'AGENTS.md'), 'WEB')
  writeFileSync(join(root, 'apps', 'web', 'src', 'AGENTS.md'), 'BELOW')
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'docs', 'AGENTS.md'), 'BESIDE')
  expect(loadRepositoryInstructions(root, 'apps/web')).toEqual([
    { path: 'AGENTS.md', content: 'ROOT' },
    { path: 'apps/web/AGENTS.md', content: 'WEB' },
  ])
  expect(loadRepositoryInstructions(root)).toEqual([{ path: 'AGENTS.md', content: 'ROOT' }])
  expect(loadRepositoryInstructions(root, 'missing/dir')).toEqual([
    { path: 'AGENTS.md', content: 'ROOT' },
  ])
})

test('follows links that stay inside the workspace, including a linked Team root', () => {
  writeFileSync(join(root, 'CLAUDE.md'), 'SHARED')
  symlinkSync('CLAUDE.md', join(root, 'AGENTS.md'))
  const linked = join(parent, 'linked-team')
  symlinkSync(root, linked)
  expect(loadRepositoryInstructions(linked)).toEqual([{ path: 'AGENTS.md', content: 'SHARED' }])
})

test('skips, without failing, files outside the workspace, oversized or not regular', () => {
  writeFileSync(join(parent, 'secret.md'), 'OUTSIDE')
  symlinkSync(join(parent, 'secret.md'), join(root, 'AGENTS.md'))
  writeFileSync(join(root, 'apps', 'AGENTS.md'), 'x'.repeat(200 * 1024))
  mkdirSync(join(root, 'apps', 'web', 'AGENTS.md'))
  expect(loadRepositoryInstructions(root, 'apps/web')).toEqual([])
  expect(console.warn).toHaveBeenCalledTimes(3)
  expect(loadRepositoryInstructions(join(parent, 'no-such-team'))).toEqual([])
})

test('a FIFO is skipped without blocking, even one swapped in after the check', () => {
  execFileSync('/usr/bin/mkfifo', [join(root, 'apps', 'AGENTS.md')])
  const file = join(root, 'AGENTS.md')
  writeFileSync(file, 'ROOT')
  hooks.afterStat = () => {
    rmSync(file)
    execFileSync('/usr/bin/mkfifo', [file])
  }
  expect(loadRepositoryInstructions(root, 'apps')).toEqual([])
  expect(console.warn).toHaveBeenCalledWith(
    '[repository-instructions] skipped AGENTS.md: it changed while it was being read',
  )
  expect(console.warn).toHaveBeenCalledWith(
    '[repository-instructions] skipped apps/AGENTS.md: it is not a regular file',
  )
})

test('a link swapped in after the check is never followed', () => {
  writeFileSync(join(parent, 'secret.md'), 'OUTSIDE')
  const file = join(root, 'AGENTS.md')
  writeFileSync(file, 'ROOT')
  hooks.afterStat = () => {
    rmSync(file)
    symlinkSync(join(parent, 'secret.md'), file)
  }
  expect(loadRepositoryInstructions(root)).toEqual([])
  expect(console.warn).toHaveBeenCalledTimes(1)
})

test.runIf(process.platform === 'linux')(
  'a directory swapped for an outside link while the file is opened is refused',
  () => {
    const outside = join(parent, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'AGENTS.md'), 'OUTSIDE')
    const apps = join(root, 'apps')
    writeFileSync(join(apps, 'AGENTS.md'), 'INSIDE')
    const parked = join(root, 'apps-parked')
    // `apps` points outside from the check through the open, and is back for the final check.
    hooks.beforeStat = () => {
      renameSync(apps, parked)
      symlinkSync(outside, apps)
    }
    hooks.afterFstat = () => {
      rmSync(apps)
      renameSync(parked, apps)
    }
    expect(loadRepositoryInstructions(root, 'apps')).toEqual([])
    expect(console.warn).toHaveBeenCalledWith(
      '[repository-instructions] skipped apps/AGENTS.md: it changed while it was being read',
    )
  },
)

test('a file that grows past the cap while it is read is skipped', () => {
  const file = join(root, 'AGENTS.md')
  writeFileSync(file, 'small')
  hooks.afterFstat = () => writeFileSync(file, 'x'.repeat(128 * 1024 + 1))
  expect(loadRepositoryInstructions(root)).toEqual([])
  expect(console.warn).toHaveBeenCalledWith(
    '[repository-instructions] skipped AGENTS.md: it is larger than 131072 bytes',
  )
})
