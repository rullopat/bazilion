import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ContextDirectory } from '../../src/lib/git/context-directory.ts'

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
  syncBuiltinESMExports()
  for (const directory of directories.splice(0)) directory.close()
  fs.rmSync(home, { recursive: true, force: true })
})
function capture(path = root): ContextDirectory {
  const directory = new ContextDirectory(path)
  directories.push(directory)
  return directory
}

test('reads exact bytes through the root and child directories', () => {
  const empty = capture()
  expect(empty.read('AGENTS.md', 100)).toBeNull()
  fs.mkdirSync(join(root, 'app'))
  fs.writeFileSync(join(root, 'AGENTS.md'), 'root\r\ninstructions\n')
  fs.writeFileSync(join(root, 'app', 'AGENTS.md'), 'child\n')
  const directory = capture()
  expect(directory.read('AGENTS.md', 100)?.toString()).toBe('root\r\ninstructions\n')
  expect(directory.directory('app').read('AGENTS.md', 100)?.toString()).toBe('child\n')
  expect(directory.identity).toMatch(/^[a-f0-9]{64}$/)
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
  // The child stays pinned to the directory it opened.
  expect(child.read('AGENTS.md', 100)?.toString()).toBe('original')
})

test('nested directory and leaf links do not disclose outside content', () => {
  const outside = join(home, 'outside')
  fs.mkdirSync(outside)
  fs.writeFileSync(join(outside, 'AGENTS.md'), 'PRIVATE-SYNTHETIC')
  fs.symlinkSync(outside, join(root, 'alias'))
  expect(() => capture().directory('alias')).toThrow()
  fs.symlinkSync(join(outside, 'AGENTS.md'), join(root, 'AGENTS.md'))
  expect(() => capture().read('AGENTS.md', 100)).toThrow('unsafe_file')
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
  // The module under test uses the named `readSync` export; propagate the spy to it.
  syncBuiltinESMExports()
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
  for (const use of [
    () => directory.read('AGENTS.md', 100),
    () => directory.entry('AGENTS.md'),
    () => directory.list(),
    () => directory.validate(),
    () => directory.directory('app'),
    () => child.read('AGENTS.md', 100),
  ])
    expect(use).toThrow('unreadable')
})
