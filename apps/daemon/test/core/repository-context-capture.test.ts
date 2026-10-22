import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ContextDirectory } from '../../src/lib/repository-context/files.ts'
import { resolveRepositoryContext } from '../../src/lib/repository-context/index.ts'

let home: string
let root: string
const directories: ContextDirectory[] = []
beforeEach(() => {
  home = fs.mkdtempSync(join(tmpdir(), 'bazilion-capture-'))
  root = join(home, 'root')
  fs.mkdirSync(root)
})
afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) directory.close()
  fs.rmSync(home, { recursive: true, force: true })
})
function capture(path = root): ContextDirectory {
  const directory = new ContextDirectory(path)
  directories.push(directory)
  return directory
}

test('empty and instructed Teams prepare complete exact-byte context', async () => {
  expect((await resolveRepositoryContext({ teamId: 'empty', root })).instructions).toEqual({
    state: 'complete',
    files: [],
    issues: [],
  })
  fs.mkdirSync(join(root, 'app'))
  fs.writeFileSync(join(root, 'AGENTS.md'), 'root\r\ninstructions\n')
  fs.writeFileSync(join(root, 'app', 'AGENTS.md'), 'child\n')
  const report = await resolveRepositoryContext({ teamId: 'project', root, target: 'app/new.ts' })
  expect(report.instructions.state).toBe('complete')
  expect(report.instructions.files.map((f) => f.content)).toEqual([
    'root\r\ninstructions\n',
    'child\n',
  ])
  expect(report.rootIdentity).toMatch(/^[a-f0-9]{64}$/)
})

test('registered root symlink is admitted, but retargeting never validates', () => {
  const slot = join(home, 'slot')
  fs.symlinkSync(root, slot)
  fs.writeFileSync(join(root, 'AGENTS.md'), 'original')
  const directory = capture(slot)
  expect(directory.read('AGENTS.md', 100)?.toString()).toBe('original')
  const other = join(home, 'other')
  fs.mkdirSync(other)
  fs.symlinkSync(other, join(home, 'other-slot'))
  fs.unlinkSync(slot)
  fs.symlinkSync(other, slot)
  expect(() => directory.validate()).toThrow('root_changed')
})

test('replacement root and child directories cannot validate an old capture', () => {
  fs.mkdirSync(join(root, 'app'))
  fs.writeFileSync(join(root, 'app', 'AGENTS.md'), 'original')
  const directory = capture()
  const child = directory.directory('app')
  expect(child.read('AGENTS.md', 100)?.toString()).toBe('original')
  fs.renameSync(join(root, 'app'), join(root, 'old-app'))
  fs.mkdirSync(join(root, 'app'))
  fs.writeFileSync(join(root, 'app', 'AGENTS.md'), 'replacement')
  expect(() => directory.validate()).toThrow('root_changed')
  if (process.platform === 'linux')
    expect(child.read('AGENTS.md', 100)?.toString()).toBe('original')
  else expect(() => child.read('AGENTS.md', 100)).toThrow('root_changed')
})

test('nested directory and leaf links do not disclose outside content', async () => {
  const outside = join(home, 'outside')
  fs.mkdirSync(outside)
  fs.writeFileSync(join(outside, 'AGENTS.md'), 'PRIVATE-SYNTHETIC')
  fs.symlinkSync(outside, join(root, 'alias'))
  const targeted = await resolveRepositoryContext({ teamId: 'test', root, target: 'alias/new.ts' })
  expect(targeted.instructions.state).toBe('incomplete')
  fs.symlinkSync(join(outside, 'AGENTS.md'), join(root, 'AGENTS.md'))
  const leaf = await resolveRepositoryContext({ teamId: 'test', root })
  expect(leaf.instructions.state).toBe('incomplete')
  expect(JSON.stringify([targeted, leaf])).not.toContain('PRIVATE-SYNTHETIC')
})

test('contained instruction links are refused too, not silently followed', () => {
  fs.writeFileSync(join(root, 'source.md'), 'instructions')
  fs.symlinkSync('source.md', join(root, 'AGENTS.md'))
  expect(() => capture().read('AGENTS.md', 100)).toThrow('unsafe_file')
})

test('absence, replacements and listings remain observations until final validation', () => {
  const directory = capture()
  expect(directory.read('AGENTS.md', 100)).toBeNull()
  fs.writeFileSync(join(root, 'AGENTS.md'), 'new')
  expect(() => directory.validate()).toThrow('source_changed')
  const observed = capture()
  expect(observed.read('AGENTS.md', 100)?.toString()).toBe('new')
  fs.unlinkSync(join(root, 'AGENTS.md'))
  fs.writeFileSync(join(root, 'AGENTS.md'), 'replacement')
  expect(() => observed.validate()).toThrow('source_changed')
  const listed = capture()
  listed.list()
  fs.writeFileSync(join(root, 'new-entry'), '')
  expect(() => listed.validate()).toThrow('source_changed')
})

test('file changes during bounded descriptor reads are rejected', () => {
  const path = join(root, 'AGENTS.md')
  fs.writeFileSync(path, 'before')
  const read = fs.readSync
  let changed = false
  vi.spyOn(fs, 'readSync').mockImplementation((...args: Parameters<typeof fs.readSync>) => {
    const count = read(...args)
    if (!changed) {
      changed = true
      fs.writeFileSync(path, 'after-content')
    }
    return count
  })
  expect(() => capture().read('AGENTS.md', 100)).toThrow('source_changed')
  expect(changed).toBe(true)
})

test('byte overflow and FIFO inputs never become successful truncated reads', () => {
  fs.writeFileSync(join(root, 'large'), 'x'.repeat(101))
  const directory = capture()
  expect(() => directory.read('large', 100)).toThrow('byte_limit')
  execFileSync('/usr/bin/mkfifo', [join(root, 'AGENTS.md')])
  expect(() => directory.read('AGENTS.md', 100)).toThrow('unsafe_file')
})

test('directory handles are closed on complete capture disposal, including children', () => {
  fs.mkdirSync(join(root, 'app'))
  const directory = capture()
  const child = directory.directory('app')
  directory.close()
  expect(() => fs.fstatSync(directory.fd)).toThrow()
  expect(() => fs.fstatSync(child.fd)).toThrow()
  expect(() => directory.close()).not.toThrow()
  expect(() => directory.read('AGENTS.md', 100)).toThrow('unreadable')
})

test('targeted captures refuse a replaced admission-bound root', async () => {
  const before = await resolveRepositoryContext({ teamId: 'test', root })
  fs.renameSync(root, `${root}-old`)
  fs.mkdirSync(root)
  const report = await resolveRepositoryContext({
    teamId: 'test',
    root,
    expectedRootIdentity: before.rootIdentity ?? 'missing',
  })
  expect(report.instructions.state).toBe('incomplete')
  expect(report.instructions.issues.some((issue) => issue.code === 'root_changed')).toBe(true)
})

test('macOS instructions do not imply an admitted hardened Git worktree', async () => {
  fs.mkdirSync(join(root, '.git'))
  fs.writeFileSync(join(root, 'AGENTS.md'), 'instructions')
  const report = await resolveRepositoryContext({ teamId: 'test', root })
  expect(report.instructions.state).toBe('complete')
  expect(report.git.state).toBe('unavailable')
  if (process.platform === 'darwin') {
    expect(report.git.issues.map((issue) => issue.code)).toContain('git_inspection_unavailable')
    expect(capture().gitWorktreePath).toBeNull()
  }
})
