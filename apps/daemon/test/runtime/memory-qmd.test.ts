import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { qmdBackend } from '../../src/runtime/memory/qmd.ts'
import type { MemoryBackend } from '../../src/runtime/memory/types.ts'

let root: string
let mem: MemoryBackend

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'bazilion-mem-qmd-'))
  mem = qmdBackend(root)
  await mem.init()
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

test('write then read returns the content', async () => {
  await mem.write('notes.md', 'hello world')
  const entry = await mem.read('notes.md')
  expect(entry.content).toBe('hello world')
  expect(entry.key).toBe('notes.md')
})

test('write to nested key creates directories', async () => {
  await mem.write('daily/2026-04-11.md', 'today')
  expect(existsSync(join(root, 'daily', '2026-04-11.md'))).toBe(true)
  const entry = await mem.read('daily/2026-04-11.md')
  expect(entry.content).toBe('today')
})

test('read missing key throws', async () => {
  await expect(mem.read('ghost.md')).rejects.toThrow(/not found/)
})

test('list returns all entries sorted by key', async () => {
  await mem.write('b.md', 'two')
  await mem.write('a.md', 'one')
  await mem.write('nested/c.md', 'three')
  const all = await mem.list()
  expect(all.map((e) => e.key)).toEqual(['a.md', 'b.md', 'nested/c.md'])
})

test('list ignores the .qmd-index.sqlite file', async () => {
  await mem.write('a.md', 'one')
  // After init(), the index file exists alongside the markdown
  expect(existsSync(join(root, '.qmd-index.sqlite'))).toBe(true)
  const all = await mem.list()
  expect(all.map((e) => e.key)).toEqual(['a.md'])
})

test('search returns matching entries via BM25', async () => {
  await mem.write('colors.md', 'My favorite color is blue.')
  await mem.write('food.md', 'I like pasta and pizza.')
  await mem.write('other.md', 'unrelated content')

  const hits = await mem.search('color')
  expect(hits.length).toBeGreaterThanOrEqual(1)
  expect(hits[0]?.key).toBe('colors.md')
  expect(hits[0]?.snippet.toLowerCase()).toContain('color')
})

test('search scores more relevant documents higher', async () => {
  await mem.write('a.md', 'pizza pizza pizza')
  await mem.write('b.md', 'I once ate pizza years ago')
  const hits = await mem.search('pizza')
  expect(hits.length).toBeGreaterThanOrEqual(2)
  // BM25 should rank the term-dense doc first.
  expect(hits[0]?.key).toBe('a.md')
})

test('remove deletes the entry and drops it from search', async () => {
  await mem.write('temp.md', 'tmp content with pizza')
  let hits = await mem.search('pizza')
  expect(hits.length).toBe(1)

  await mem.remove('temp.md')
  expect(existsSync(join(root, 'temp.md'))).toBe(false)

  hits = await mem.search('pizza')
  expect(hits.length).toBe(0)
})

test('rejects unsafe keys with path traversal', async () => {
  await expect(mem.write('../../../etc/passwd', 'x')).rejects.toThrow(/unsafe/)
  await expect(mem.write('/abs/path', 'x')).rejects.toThrow(/unsafe/)
})

test('persistence: a new backend instance sees previously written entries', async () => {
  await mem.write('persist.md', 'survives restart')
  const fresh = qmdBackend(root)
  await fresh.init()
  const entry = await fresh.read('persist.md')
  expect(entry.content).toBe('survives restart')
  const hits = await fresh.search('survives')
  expect(hits.length).toBeGreaterThanOrEqual(1)
})
