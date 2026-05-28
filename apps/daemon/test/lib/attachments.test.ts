import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { saveInputFiles } from '../../src/lib/attachments.ts'
import { deliverFileTool } from '../../src/runtime/tools/deliver-file.ts'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bz-attach-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const b64 = (s: string) => Buffer.from(s).toString('base64')

test('saveInputFiles writes uploads + returns a path reference note', () => {
  const note = saveInputFiles(dir, [
    { name: 'report.txt', mimeType: 'text/plain', data: b64('hello doc') },
  ])
  expect(note).toMatch(/\[file saved to .*uploads.*report\.txt \(text\/plain, \d+ B\)/)
  // the referenced path actually exists with the right bytes
  const path = note.match(/saved to (\S+)/)?.[1] ?? ''
  expect(existsSync(path)).toBe(true)
  expect(readFileSync(path, 'utf8')).toBe('hello doc')
})

test('saveInputFiles returns empty string when there are no files', () => {
  expect(saveInputFiles(dir, undefined)).toBe('')
  expect(saveInputFiles(dir, [])).toBe('')
})

test('saveInputFiles skips oversized files with a note instead of storing', () => {
  const huge = b64('x'.repeat(26 * 1024 * 1024))
  const note = saveInputFiles(dir, [
    { name: 'big.bin', mimeType: 'application/octet-stream', data: huge },
  ])
  expect(note).toMatch(/skipped: too large/)
})

test('deliverFileTool reads a workspace file and emits it via the sink', async () => {
  writeFileSync(join(dir, 'out.csv'), 'a,b,c\n1,2,3')
  const sent: Array<{ name: string; mimeType: string; data: string }> = []
  const tool = deliverFileTool(dir, (f) => sent.push(f))
  const res = await tool.invoke({ path: 'out.csv' })
  expect(res).toMatch(/Delivered "out\.csv"/)
  expect(sent).toHaveLength(1)
  expect(sent[0]?.name).toBe('out.csv')
  expect(sent[0]?.mimeType).toBe('text/csv')
  expect(Buffer.from(sent[0]?.data ?? '', 'base64').toString('utf8')).toBe('a,b,c\n1,2,3')
})

test('deliverFileTool throws on a missing file', async () => {
  const tool = deliverFileTool(dir, () => {})
  await expect(tool.invoke({ path: 'nope.txt' })).rejects.toThrow(/no such file/)
})
