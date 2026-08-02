import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { saveInputFiles } from '../../src/lib/attachments.ts'
import { deliverFileTool } from '../../src/runtime/tools/deliver-file.ts'

let root: string
let dir: string
let outsideDir: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bz-attach-'))
  dir = join(root, 'workspace')
  outsideDir = join(root, 'outside')
  mkdirSync(dir)
  mkdirSync(outsideDir)
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
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

test('saveInputFiles can expose a Docker mount path without changing private storage', () => {
  const note = saveInputFiles(
    dir,
    [{ name: 'brief.pdf', mimeType: 'application/pdf', data: b64('pdf bytes') }],
    { referenceDir: '/inputs' },
  )

  expect(note).toMatch(/saved to \/inputs\/[a-f0-9]{8}-brief\.pdf/)
  const stored = join(dir, 'uploads', note.match(/([a-f0-9]{8}-brief\.pdf)/)?.[1] ?? '')
  expect(readFileSync(stored, 'utf8')).toBe('pdf bytes')
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

test('deliverFileTool rejects an absolute path even when it names a workspace file', async () => {
  const path = join(dir, 'inside.txt')
  writeFileSync(path, 'inside')
  const sent: unknown[] = []
  const tool = deliverFileTool(dir, (file) => sent.push(file))

  await expect(tool.invoke({ path })).rejects.toThrow(/must stay within the workspace/)
  expect(sent).toEqual([])
})

test('deliverFileTool rejects lexical traversal outside the workspace', async () => {
  writeFileSync(join(outsideDir, 'secret.txt'), 'outside')
  const sent: unknown[] = []
  const tool = deliverFileTool(dir, (file) => sent.push(file))

  await expect(tool.invoke({ path: '../outside/secret.txt' })).rejects.toThrow(
    /must stay within the workspace/,
  )
  expect(sent).toEqual([])
})

test('deliverFileTool rejects a file symlink that escapes the workspace', async () => {
  const outside = join(outsideDir, 'secret.txt')
  writeFileSync(outside, 'outside')
  symlinkSync(outside, join(dir, 'secret-link.txt'))
  const sent: unknown[] = []
  const tool = deliverFileTool(dir, (file) => sent.push(file))

  await expect(tool.invoke({ path: 'secret-link.txt' })).rejects.toThrow(
    /must stay within the workspace/,
  )
  expect(sent).toEqual([])
})

test('deliverFileTool rejects an intermediate directory symlink that escapes', async () => {
  writeFileSync(join(outsideDir, 'secret.txt'), 'outside')
  symlinkSync(outsideDir, join(dir, 'escape'), 'dir')
  const sent: unknown[] = []
  const tool = deliverFileTool(dir, (file) => sent.push(file))

  await expect(tool.invoke({ path: 'escape/secret.txt' })).rejects.toThrow(
    /must stay within the workspace/,
  )
  expect(sent).toEqual([])
})

test('deliverFileTool allows an internal symlink to a regular workspace file', async () => {
  writeFileSync(join(dir, 'report.md'), '# Safe report')
  symlinkSync('report.md', join(dir, 'latest.md'))
  const sent: Array<{ name: string; mimeType: string; data: string }> = []
  const tool = deliverFileTool(dir, (file) => sent.push(file))

  await expect(tool.invoke({ path: 'latest.md' })).resolves.toMatch(/Delivered "latest\.md"/)
  expect(Buffer.from(sent[0]?.data ?? '', 'base64').toString('utf8')).toBe('# Safe report')
})

test('deliverFileTool supports a workspace root that is itself a registered symlink', async () => {
  const linkedWorkspace = join(root, 'workspace-link')
  symlinkSync(dir, linkedWorkspace, 'dir')
  writeFileSync(join(dir, 'report.txt'), 'linked team')
  const sent: Array<{ name: string; mimeType: string; data: string }> = []
  const tool = deliverFileTool(linkedWorkspace, (file) => sent.push(file))

  await expect(tool.invoke({ path: 'report.txt' })).resolves.toMatch(/Delivered "report\.txt"/)
  expect(Buffer.from(sent[0]?.data ?? '', 'base64').toString('utf8')).toBe('linked team')
})

test('deliverFileTool rejects directories because only regular files may be delivered', async () => {
  mkdirSync(join(dir, 'folder'))
  const sent: unknown[] = []
  const tool = deliverFileTool(dir, (file) => sent.push(file))

  await expect(tool.invoke({ path: 'folder' })).rejects.toThrow(/not a regular file/)
  expect(sent).toEqual([])
})
