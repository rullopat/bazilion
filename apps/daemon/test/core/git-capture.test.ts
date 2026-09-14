import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import {
  type CapturedGit,
  captureRepositoryGit,
  findRepositoryRoot,
} from '../../src/lib/git/capture.ts'
import { ContextDirectory, ContextReadError } from '../../src/lib/repository-context/files.ts'

// BAZ-042 reads diffs through the same hardened capture BAZ-039 uses for status. These tests cover
// the capability that BAZ-039 never exercised: a *second* read-only invocation, and the guarantee
// that repository-configured executables cannot run during it.

let parent: string
let root: string
beforeEach(() => {
  parent = mkdtempSync(join(tmpdir(), 'bazilion-git-capture-'))
  root = join(parent, 'repo')
  mkdirSync(root)
})
afterEach(() => rmSync(parent, { recursive: true, force: true }))

function git(...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: {
      PATH: '/usr/bin:/bin',
      HOME: parent,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  }).trim()
}

function repo(): void {
  git('init', '-q', '-b', 'main')
  writeFileSync(join(root, 'code.txt'), 'one\n')
  git('add', '.')
  git('commit', '-qm', 'initial')
}

/** Capture the repository through the fd-pinned directory, as the daemon does. */
async function capture(): Promise<{ capture: CapturedGit; directory: ContextDirectory }> {
  const directory = new ContextDirectory(root)
  const found = findRepositoryRoot([directory])
  if (!found) throw new Error('fixture is not a repository')
  return { capture: await captureRepositoryGit(found), directory }
}

/** Run `fn` with a capture, always closing the directory afterwards. */
async function withCapture(fn: (captured: CapturedGit) => Promise<void>): Promise<void> {
  const { capture: captured, directory } = await capture()
  try {
    await fn(captured)
  } finally {
    captured.cleanup()
    directory.close()
  }
}

test('a captured repository serves further read-only invocations', async () => {
  repo()
  writeFileSync(join(root, 'code.txt'), 'changed\n')
  writeFileSync(join(root, 'untracked.txt'), 'new\n')
  const head = git('rev-parse', 'HEAD')
  await withCapture(async (captured) => {
    expect((await captured.runGit(['rev-parse', 'HEAD'])).trim()).toBe(head)
    expect((await captured.runGit(['diff', '--name-only'])).trim()).toBe('code.txt')
    // The capture pins the worktree through /proc/<pid>/fd, so a diff read still sees the tree.
    expect(await captured.runGit(['diff', '--', 'code.txt'])).toContain('-one')
    expect(await captured.runGit(['diff', '--', 'code.txt'])).toContain('+changed')
  })
})

test('diff reads cannot execute repository-configured helpers', async () => {
  repo()
  const marker = join(parent, 'HELPER_EXECUTED')
  const helper = join(parent, 'helper')
  writeFileSync(helper, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 })
  // Every mechanism that could let repository state run code during a diff. These keys are not
  // carried into the neutral inspection config, so they are dropped rather than honoured.
  // (`filter.*` is stronger still: it makes the capture refuse the repository outright — see
  // apps/daemon/test/core/repository-context.test.ts.)
  git('config', 'diff.external', helper)
  git('config', 'core.fsmonitor', helper)
  git('config', 'diff.evil.textconv', helper)
  writeFileSync(join(root, '.gitattributes'), '* diff=evil\n')
  writeFileSync(join(root, 'code.txt'), 'changed\n')
  await withCapture(async (captured) => {
    // A real diff is produced, and nothing executed to produce it.
    expect(await captured.runGit(['diff', '--', 'code.txt'])).toContain('+changed')
    expect((await captured.runGit(['status', '--porcelain=v2'])).trim()).not.toBe('')
  })
  expect(existsSync(marker)).toBe(false)
})

test('diff reads leave the index and worktree untouched', async () => {
  repo()
  writeFileSync(join(root, 'code.txt'), 'changed\n')
  git('add', 'code.txt')
  writeFileSync(join(root, 'code.txt'), 'staged then changed\n')
  const indexBefore = readFileSync(join(root, '.git', 'index'))
  const statusBefore = git('status', '--porcelain=v2')
  await withCapture(async (captured) => {
    await captured.runGit(['diff'])
    await captured.runGit(['diff', '--cached'])
    await captured.runGit(['status', '--porcelain=v2'])
  })
  expect(readFileSync(join(root, '.git', 'index'))).toEqual(indexBefore)
  expect(git('status', '--porcelain=v2')).toBe(statusBefore)
})

test('a non-repository has no capture root', () => {
  const directory = new ContextDirectory(root)
  try {
    expect(findRepositoryRoot([directory])).toBeNull()
  } finally {
    directory.close()
  }
})

test('an unsupported metadata layout is refused', async () => {
  repo()
  // A linked worktree records its git-dir elsewhere; the capture refuses it outright.
  writeFileSync(join(root, '.git', 'commondir'), '../..\n')
  const directory = new ContextDirectory(root)
  const found = findRepositoryRoot([directory])
  try {
    expect(found).not.toBeNull()
    if (!found) throw new Error('fixture is not a repository')
    await expect(captureRepositoryGit(found)).rejects.toThrow(ContextReadError)
    await expect(captureRepositoryGit(found)).rejects.toThrow('unsupported_git_metadata')
  } finally {
    directory.close()
  }
})
