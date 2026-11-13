import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import {
  type CapturedGit,
  captureRepositoryGit,
  findRepositoryRoot,
} from '../../src/lib/git/capture.ts'
import { ContextDirectory, ContextReadError } from '../../src/lib/git/context-directory.ts'
import { runGit } from '../fixtures/git.ts'

// BAZ-042 reads diffs through this hardened capture: a read-only copy of the metadata with a
// Bazilion-authored config. These tests cover repeated read-only invocations, the guarantee that
// repository-configured executables cannot run, and the metadata the capture refuses.

let parent: string
let root: string
beforeEach(() => {
  parent = mkdtempSync(join(tmpdir(), 'bazilion-git-capture-'))
  root = join(parent, 'repo')
  mkdirSync(root)
})
afterEach(() => rmSync(parent, { recursive: true, force: true }))

const git = (...args: string[]) => runGit(root, parent, ...args)

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
  // the unsupported-configuration test below.)
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

test('a repository above the Team root is never used', () => {
  repo()
  const folder = join(root, 'folder')
  mkdirSync(folder)
  const directory = new ContextDirectory(folder)
  try {
    expect(findRepositoryRoot([directory])).toBeNull()
  } finally {
    directory.close()
  }
})

test('local filemode and excludes keep ordinary Git status semantics', async () => {
  repo()
  git('config', 'core.filemode', 'false')
  chmodSync(join(root, 'code.txt'), 0o755)
  writeFileSync(join(root, '.git', 'info', 'exclude'), 'local-ignored\n')
  writeFileSync(join(root, 'local-ignored'), 'local data')
  expect(git('status', '--porcelain')).toBe('')
  await withCapture(async (captured) => {
    expect((await captured.runGit(['status', '--porcelain'])).trim()).toBe('')
  })
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

/** The capture's refusal code for the current repository state. */
async function refusal(): Promise<string> {
  const directory = new ContextDirectory(root)
  try {
    const found = findRepositoryRoot([directory])
    if (!found) throw new Error('fixture is not a repository')
    const captured = await captureRepositoryGit(found).catch((error: unknown) => error)
    if (!(captured instanceof ContextReadError)) {
      ;(captured as CapturedGit).cleanup()
      throw new Error('capture was not refused')
    }
    return captured.code
  } finally {
    directory.close()
  }
}

test.each([
  'include.path',
  'filter.external.clean',
  'core.excludesFile',
])('unsupported configuration %s is refused, never executed or followed', async (key) => {
  repo()
  git('config', key, '/private/unavailable')
  expect(await refusal()).toBe('unsupported_git_configuration')
})

test('external object links and alternates are refused', async () => {
  repo()
  writeFileSync(join(root, '.git', 'objects', 'info', 'alternates'), '/private/objects\n')
  await expect(refusal()).resolves.toBeTruthy()
  unlinkSync(join(root, '.git', 'objects', 'info', 'alternates'))
  symlinkSync(parent, join(root, '.git', 'objects', 'escape'))
  await expect(refusal()).resolves.toBeTruthy()
})

test('a .git file pointing at metadata elsewhere is refused', async () => {
  repo()
  const folder = join(root, 'folder')
  mkdirSync(folder)
  writeFileSync(join(folder, '.git'), `gitdir: ${join(root, '.git')}\n`)
  const directory = new ContextDirectory(folder)
  try {
    const found = findRepositoryRoot([directory])
    if (found) await expect(captureRepositoryGit(found)).rejects.toThrow(ContextReadError)
  } finally {
    directory.close()
  }
})
