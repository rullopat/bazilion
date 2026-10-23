import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { type CapturedGit, captureRepositoryGit } from '../../src/lib/git/capture.ts'
import { readRepositoryIdentity, resolveComparisonBase } from '../../src/lib/git-review/identity.ts'
import { captureSourceSnapshot, compareSnapshots } from '../../src/lib/git-review/snapshot.ts'
import { ContextDirectory } from '../../src/lib/repository-context/files.ts'

// Force the private backend on Linux too, exercising real Git and real guarded source reads.
// The same tests run on actual macOS; simulated selection is not macOS qualification.
let home: string
let root: string
const directories: ContextDirectory[] = []
const captures: CapturedGit[] = []
beforeEach(() => {
  home = fs.mkdtempSync(join(tmpdir(), 'bazilion-private-git-'))
  root = join(home, 'repo')
  fs.mkdirSync(root)
  vi.spyOn(ContextDirectory.prototype, 'gitWorktreePath', 'get').mockReturnValue(null)
  git('init', '-q', '-b', 'main')
  fs.writeFileSync(join(root, 'code.txt'), 'initial\n')
  git('add', '.')
  git('commit', '-qm', 'initial')
})
afterEach(() => {
  vi.restoreAllMocks()
  for (const captured of captures.splice(0)) captured.cleanup()
  for (const directory of directories.splice(0)) directory.close()
  fs.rmSync(home, { recursive: true, force: true })
})
function git(...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: {
      PATH: '/usr/bin:/bin',
      HOME: home,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  })
}
async function capture(path = root): Promise<CapturedGit> {
  const directory = new ContextDirectory(path)
  directories.push(directory)
  const captured = await captureRepositoryGit(directory)
  captures.push(captured)
  return captured
}

test('private Git agrees on staged, unstaged, deleted, untracked and executable files', async () => {
  fs.writeFileSync(join(root, 'code.txt'), 'staged\n')
  git('add', 'code.txt')
  fs.writeFileSync(join(root, 'code.txt'), 'staged then edited\n')
  fs.writeFileSync(join(root, 'new space ü.txt'), 'untracked\n')
  fs.writeFileSync(join(root, 'tab\tname\n.txt'), 'tracked control characters\n')
  git('add', '--', 'tab\tname\n.txt')
  fs.writeFileSync(join(root, 'executable'), '#!/bin/sh\n', { mode: 0o700 })
  git('add', 'executable')
  fs.chmodSync(join(root, 'executable'), 0o600)
  fs.writeFileSync(join(root, 'removed'), 'removed\n')
  git('add', 'removed')
  fs.unlinkSync(join(root, 'removed'))
  const index = fs.readFileSync(join(root, '.git', 'index'))
  const expectedStatus = git('status', '--porcelain=v1', '-z')
  const expectedDiff = git('diff', '--no-ext-diff')
  const captured = await capture()
  expect(await captured.runGit(['status', '--porcelain=v1', '-z'])).toBe(expectedStatus)
  expect(await captured.runGit(['diff', '--no-ext-diff'])).toBe(expectedDiff)
  expect(captured.root.read('code.txt', 100)?.toString()).toBe('staged then edited\n')
  expect(fs.readFileSync(join(root, '.git', 'index'))).toEqual(index)
  expect(git('status', '--porcelain=v1', '-z')).toBe(expectedStatus)
})

test('ignored dependency trees are skipped without following links or copying their bytes', async () => {
  fs.writeFileSync(join(root, '.gitignore'), 'node_modules/\n*.log\n')
  fs.mkdirSync(join(root, 'node_modules'))
  fs.symlinkSync(home, join(root, 'node_modules', 'outside'))
  fs.writeFileSync(join(root, 'noise.log'), 'not captured')
  fs.writeFileSync(join(root, '.git', 'info', 'exclude'), 'local-only/\n')
  fs.mkdirSync(join(root, 'local-only'))
  fs.symlinkSync(home, join(root, 'local-only', 'outside'))
  const captured = await capture()
  expect(captured.root.entry('node_modules')).toBeNull()
  expect(captured.root.entry('noise.log')).toBeNull()
  expect(captured.root.entry('local-only')).toBeNull()
  expect(await captured.runGit(['status', '--porcelain=v1', '-z'])).toBe(
    git('status', '--porcelain=v1', '-z'),
  )
})

test('nested ignore rules and negation work, and tracked ignored paths are still copied', async () => {
  fs.writeFileSync(join(root, '.gitignore'), 'ignored/\n*.log\n')
  fs.mkdirSync(join(root, 'ignored'))
  fs.writeFileSync(join(root, 'ignored', 'tracked.log'), 'tracked ignored\n')
  git('add', '-f', 'ignored/tracked.log')
  fs.writeFileSync(join(root, 'ignored', 'other'), 'ignored\n')
  fs.mkdirSync(join(root, 'src'))
  fs.writeFileSync(join(root, 'src', '.gitignore'), '!keep.log\n')
  fs.writeFileSync(join(root, 'src', 'keep.log'), 'kept\n')
  fs.writeFileSync(join(root, 'src', 'drop.log'), 'dropped\n')
  const captured = await capture()
  expect(await captured.runGit(['status', '--porcelain=v1', '-z'])).toBe(
    git('status', '--porcelain=v1', '-z'),
  )
  expect(captured.root.directory('ignored').read('tracked.log', 100)?.toString()).toBe(
    'tracked ignored\n',
  )
  const src = captured.root.directory('src')
  expect(src.read('keep.log', 100)?.toString()).toBe('kept\n')
  expect(src.entry('drop.log')).toBeNull()
})

test('a registered root link works, but retargeting cannot validate the capture', async () => {
  const slot = join(home, 'slot')
  fs.symlinkSync(root, slot)
  const captured = await capture(slot)
  fs.mkdirSync(join(home, 'replacement'))
  fs.unlinkSync(slot)
  fs.symlinkSync(join(home, 'replacement'), slot)
  expect(() => captured.validate()).toThrow('root_changed')
})

test('private bytes and Git remain frozen, while original source drift refuses validation', async () => {
  fs.writeFileSync(join(root, 'code.txt'), 'captured content\n')
  const captured = await capture()
  fs.writeFileSync(join(root, 'code.txt'), 'later source content\n')
  expect(captured.root.read('code.txt', 100)?.toString()).toBe('captured content\n')
  expect(await captured.runGit(['diff', '--', 'code.txt'])).toContain('+captured content')
  expect(await captured.runGit(['diff', '--', 'code.txt'])).not.toContain('later source')
  expect(() => captured.validate()).toThrow('source_changed')
})

test('new files and replaced directories cannot validate an earlier capture', async () => {
  fs.mkdirSync(join(root, 'app'))
  fs.writeFileSync(join(root, 'app', 'file'), 'initial')
  const captured = await capture()
  fs.renameSync(join(root, 'app'), join(root, 'old-app'))
  fs.mkdirSync(join(root, 'app'))
  fs.writeFileSync(join(root, 'app', 'file'), 'replacement')
  expect(() => captured.validate()).toThrow()
})

test('source mutation during materialization cannot return a successful capture', async () => {
  const read = ContextDirectory.prototype.read
  vi.spyOn(ContextDirectory.prototype, 'read').mockImplementation(function (
    this: ContextDirectory,
    name,
    maxBytes,
  ) {
    const content = read.call(this, name, maxBytes)
    if (name === 'code.txt') fs.writeFileSync(join(root, name), 'changed during capture\n')
    return content
  })
  await expect(capture()).rejects.toThrow('source_changed')
})

test.each([
  'file-link',
  'directory-link',
  'hardlink',
  'fifo',
  'nested-repository',
])('an unignored %s cannot become a private worktree', async (kind) => {
  const path = join(root, 'unsafe')
  if (kind === 'file-link') fs.symlinkSync(join(root, 'code.txt'), path)
  if (kind === 'directory-link') fs.symlinkSync(home, path)
  if (kind === 'hardlink') fs.linkSync(join(root, 'code.txt'), path)
  if (kind === 'fifo') execFileSync('/usr/bin/mkfifo', [path])
  if (kind === 'nested-repository') {
    fs.mkdirSync(path)
    fs.mkdirSync(join(path, '.git'))
  }
  await expect(capture()).rejects.toThrow()
})

test('oversized files refuse instead of creating a truncated successful view', async () => {
  fs.writeFileSync(join(root, 'large'), '')
  fs.truncateSync(join(root, 'large'), 64 * 1024 * 1024 + 1)
  await expect(capture()).rejects.toThrow('byte_limit')
})

test('excessive worktree depth refuses rather than omitting a subtree', async () => {
  fs.mkdirSync(join(root, ...Array.from({ length: 18 }, () => 'dir')), { recursive: true })
  await expect(capture()).rejects.toThrow('git_worktree_limit')
})

test('repository-configured executable helpers cannot run against the private tree', async () => {
  const marker = join(home, 'HELPER_EXECUTED')
  const helper = join(home, 'helper')
  fs.writeFileSync(helper, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 })
  git('config', 'diff.external', helper)
  git('config', 'core.fsmonitor', helper)
  git('config', 'diff.evil.textconv', helper)
  fs.writeFileSync(join(root, '.gitattributes'), '* diff=evil\n')
  fs.writeFileSync(join(root, 'code.txt'), 'changed\n')
  const captured = await capture()
  expect(await captured.runGit(['diff', '--', 'code.txt'])).toContain('+changed')
  expect(fs.existsSync(marker)).toBe(false)
})

test('source snapshots fingerprint private bytes and a fresh capture detects later edits', async () => {
  fs.writeFileSync(join(root, 'code.txt'), 'first edit\n')
  const captured = await capture()
  const base = await resolveComparisonBase(captured, 'HEAD')
  const identity = await readRepositoryIdentity(captured)
  const first = await captureSourceSnapshot(captured, base, identity)
  expect(first.complete).toBe(true)
  fs.writeFileSync(join(root, 'code.txt'), 'second edit with different bytes\n')
  const frozen = await captureSourceSnapshot(captured, base, identity)
  expect(compareSnapshots(first, frozen)).toBe('identical')
  const refreshed = await capture()
  const second = await captureSourceSnapshot(
    refreshed,
    await resolveComparisonBase(refreshed, 'HEAD'),
    await readRepositoryIdentity(refreshed),
  )
  expect(second.complete).toBe(true)
  expect(compareSnapshots(first, second)).toBe('changed')
  expect(second.entries[0]?.digest).not.toBe(first.entries[0]?.digest)
})

test('cleanup removes the private bytes and prevents further Git invocations', async () => {
  const captured = await capture()
  const path = fs.realpathSync(captured.root.path)
  captured.cleanup()
  expect(fs.existsSync(path)).toBe(false)
  expect(() => captured.root.read('code.txt', 100)).toThrow('unreadable')
  await expect(captured.runGit(['status', '--porcelain=v1'])).rejects.toThrow('unreadable')
  expect(() => captured.cleanup()).not.toThrow()
})
