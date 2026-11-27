import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { readFromRoots } from '../../src/runtime/safe-files.ts'
import { parsePages, pdfReadTool, viewImageTool } from '../../src/runtime/tools/documents.ts'
import { makePdf } from '../fixtures/pdf.ts'
import { type MockServer, startMockServer } from './mock-server.ts'

// A 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)
let root: string
let workspace: string
let uploads: string
let server: MockServer | null = null
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'bazilion-documents-')))
  workspace = join(root, 'team')
  uploads = join(root, 'uploads')
  mkdirSync(workspace)
  mkdirSync(uploads)
})
afterEach(async () => {
  await server?.stop()
  server = null
  rmSync(root, { recursive: true, force: true })
})
const readFile = (path: string) => readFromRoots(path, [workspace, uploads], workspace)

test('view_image shows pictures from files, the web and saved results, and says what it could not', async () => {
  writeFileSync(join(workspace, 'chart.png'), PNG)
  writeFileSync(join(uploads, 'photo.png'), PNG)
  writeFileSync(join(workspace, 'notes.txt'), 'not a picture')
  writeFileSync(join(root, 'outside.png'), PNG)
  symlinkSync(join(root, 'outside.png'), join(workspace, 'link.png'))
  server = await startMockServer(
    () => new Response(PNG, { headers: { 'content-type': 'image/png' } }),
  )
  const tool = viewImageTool({
    readFile,
    allowPrivate: true,
    readResult: async (id) => {
      if (id !== 'result-1') throw new Error(`you have no saved result ${id}`)
      return { name: 'made.png', mimeType: 'image/png', data: PNG.toString('base64') }
    },
  })
  const parts = await tool.invoke({
    paths: ['chart.png', join(uploads, 'photo.png'), 'notes.txt', 'link.png', '../outside.png'],
    urls: [`${server.url}/pic.png`],
    results: ['result-1', 'result-2'],
  })
  if (!Array.isArray(parts)) throw new Error('expected parts')
  expect(parts.filter((part) => part.type === 'image')).toHaveLength(4)
  expect(parts[0]).toEqual({
    type: 'text',
    text: `Picture 1: chart.png (image/png, ${PNG.byteLength} B)`,
  })
  const notes = parts.at(-1)
  expect(notes?.type === 'text' && notes.text).toMatch(/^Not shown: /)
  const said = notes?.type === 'text' ? notes.text : ''
  expect(said).toContain('notes.txt: not a PNG, JPEG, GIF or WebP picture')
  expect(said).toContain('link.png:')
  expect(said).toContain('../outside.png: ../outside.png is not in your workspace or uploads')
  expect(said).toContain('result-2: you have no saved result result-2')
  await expect(tool.invoke({ paths: ['notes.txt'] })).rejects.toThrow(/nothing to show/)
  await expect(tool.invoke({})).rejects.toThrow(/at least one/)
})

test('pdf_read gives the text page by page, marks a page without text, and reads in parts', async () => {
  writeFileSync(
    join(workspace, 'report.pdf'),
    makePdf([['Quarterly report', 'Revenue grew'], [], ['Appendix (tables)']]),
  )
  const tool = pdfReadTool({ readFile })
  const all = String(await tool.invoke({ path: 'report.pdf' }))
  expect(all).toMatch(/^report\.pdf: 3 pages\. Part 1 of 1\n/)
  expect(all).toContain('--- Page 1 ---\nQuarterly report\nRevenue grew')
  expect(all).toContain('--- Page 2: no text (a scanned page, or only pictures) ---')
  expect(all).toContain('--- Page 3 ---\nAppendix (tables)')
  const one = String(await tool.invoke({ path: 'report.pdf', pages: '3' }))
  expect(one).not.toContain('Page 1')
  expect(one).toContain('report.pdf: 3 pages, pages 3. Part 1 of 1')
  await expect(tool.invoke({ path: 'report.pdf', pages: '4' })).rejects.toThrow(
    /pages 1 to 3, not 4/,
  )
  writeFileSync(join(workspace, 'fake.pdf'), 'hello')
  await expect(tool.invoke({ path: 'fake.pdf' })).rejects.toThrow(/not a PDF that can be read/)

  // Many long pages come in parts, each saying how to read on.
  const line = 'x'.repeat(90)
  writeFileSync(
    join(workspace, 'book.pdf'),
    makePdf(Array.from({ length: 12 }, () => Array.from({ length: 30 }, () => line))),
  )
  const first = String(await tool.invoke({ path: 'book.pdf' }))
  const [header] = first.split('\n')
  expect(header).toMatch(/^book\.pdf: 12 pages\. Part 1 of (\d+) — read on with pdf_read/)
  expect(header).toContain('{"path":"book.pdf","part":2}')
  const second = String(await tool.invoke({ path: 'book.pdf', part: 2 }))
  expect(second).toMatch(/Part 2 of/)
})

test('pages read as numbers and ranges, in order and once', () => {
  expect(parsePages('3', 5)).toEqual([3])
  expect(parsePages('4-5, 1,2-3', 5)).toEqual([1, 2, 3, 4, 5])
  expect(() => parsePages('2-1', 5)).toThrow(/not 2-1/)
  expect(() => parsePages('first', 5)).toThrow(/is not pages/)
})
