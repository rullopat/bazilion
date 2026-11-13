import { expect, test } from 'vitest'
import {
  capText,
  clip,
  FIELD_CHARS,
  formatSnapshot,
  MAX_TEXT_CHARS,
  PAGE_CHARS,
  splitPages,
} from '../../src/lib/browser/snapshot.ts'

test('a short snapshot is one page', () => {
  expect(splitPages('- heading "Hi"\n- button "Go" [ref=e2]')).toEqual([
    '- heading "Hi"\n- button "Go" [ref=e2]',
  ])
  expect(splitPages('')).toEqual([''])
})

test('a long snapshot splits at line breaks and loses nothing', () => {
  const lines = Array.from({ length: 300 }, (_, i) => `- paragraph: line ${i} ${'x'.repeat(40)}`)
  const pages = splitPages(lines.join('\n'), 1_000)
  expect(pages.length).toBeGreaterThan(10)
  for (const page of pages) expect(page.length).toBeLessThanOrEqual(1_000)
  expect(pages.join('\n')).toBe(lines.join('\n'))
})

test('a line longer than a page is cut, never between surrogate halves', () => {
  const line = `${'a'.repeat(9)}😀${'b'.repeat(20)}`
  const pages = splitPages(line, 10)
  expect(pages.join('')).toBe(line)
  for (const page of pages) expect(page).not.toMatch(/^[\udc00-\udfff]|[\ud800-\udbff]$/)
})

test('each page says where it came from and how to read the next one', () => {
  const snapshot = { tabId: 'tab-1', url: 'https://a.example/', title: 'A', pages: ['one', 'two'] }
  expect(formatSnapshot(snapshot, 1)).toBe(
    [
      '- Page URL: https://a.example/',
      '- Page title: A',
      '- Snapshot of tab-1, page 1 of 2 — read on with browser_snapshot {"page": 2}',
      '',
      'one',
    ].join('\n'),
  )
  expect(formatSnapshot(snapshot, 2)).toContain('page 2 of 2\n\ntwo')
})

test('a page-controlled title or URL cannot blow up the header', () => {
  const snapshot = {
    tabId: 'tab-1',
    url: `https://a.example/${'u'.repeat(2_000_000)}`,
    title: 't'.repeat(100_000),
    pages: ['body'],
  }
  const formatted = formatSnapshot(snapshot)
  expect(formatted.length).toBeLessThan(2 * FIELD_CHARS + 200)
  expect(formatted).toContain(`- Page title: ${'t'.repeat(FIELD_CHARS)}…\n`)
  expect(formatted.endsWith('\n\nbody')).toBe(true)
})

test('a full snapshot page with its header fits under the result cap', () => {
  const page = 'x'.repeat(PAGE_CHARS)
  const formatted = formatSnapshot({
    tabId: 'tab-1',
    url: 'u'.repeat(1e5),
    title: 't',
    pages: [page],
  })
  expect(capText(formatted)).toBe(formatted)
})

test('fields are clipped and any text is capped, never between surrogate halves', () => {
  expect(clip('short')).toBe('short')
  expect(clip(`${'a'.repeat(9)}😀tail`, 10)).toBe(`${'a'.repeat(9)}…`)
  expect(capText('short')).toBe('short')
  const capped = capText('z'.repeat(MAX_TEXT_CHARS + 50))
  expect(capped.startsWith('z'.repeat(MAX_TEXT_CHARS))).toBe(true)
  expect(capped.endsWith('(truncated)')).toBe(true)
  expect(capped.length).toBeLessThan(MAX_TEXT_CHARS + 20)
})
