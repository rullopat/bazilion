// Markdown → Telegram-HTML converter tests. Pure (no DB): exercises the
// token walk for every supported feature + the approximations (heading emoji
// prefix, list bullets, monospace tables, hr) and the tag-aware chunk splitter.

import { describe, expect, test } from 'vitest'
import {
  markdownToTelegramHtml,
  renderTelegramMessages,
  splitTelegramHtml,
  stripTelegramHtml,
  TELEGRAM_SAFE_BUDGET,
} from '../../src/lib/telegram/markdown.ts'

const md = markdownToTelegramHtml

describe('markdownToTelegramHtml — inline', () => {
  test('bold / italic / strikethrough / inline code', () => {
    expect(md('**b** _i_ ~~s~~ `c`')).toBe('<b>b</b> <i>i</i> <s>s</s> <code>c</code>')
  })

  test('bold nested inside italic', () => {
    expect(md('_outer **inner** end_')).toBe('<i>outer <b>inner</b> end</i>')
  })

  test('links render as <a> with the href', () => {
    expect(md('[site](https://example.com)')).toBe('<a href="https://example.com">site</a>')
  })

  test('unsafe link schemes degrade to plain text (no <a>)', () => {
    // javascript: would make Telegram reject the whole message — strip the anchor.
    expect(md('[x](javascript:alert(1))')).toBe('x')
  })

  test('HTML special chars are escaped', () => {
    expect(md('1 < 2 && 3 > 2')).toBe('1 &lt; 2 &amp;&amp; 3 &gt; 2')
  })

  test('inline raw HTML is emitted as literal text, not tags', () => {
    expect(md('a <script>x</script> b')).toContain('&lt;script&gt;')
    expect(md('a <script>x</script> b')).not.toContain('<script>')
  })
})

describe('markdownToTelegramHtml — headings', () => {
  test('h1 gets the bar glyph, h2 the triangle, both bold', () => {
    expect(md('# Title')).toBe('▎ <b>Title</b>')
    expect(md('## Sub')).toBe('▸ <b>Sub</b>')
  })

  test('h3+ collapse to the deep glyph (Telegram has no font sizing)', () => {
    expect(md('### Deep')).toBe('· <b>Deep</b>')
  })
})

describe('markdownToTelegramHtml — lists', () => {
  test('unordered list uses bullet markers', () => {
    expect(md('- one\n- two')).toBe('• one\n• two')
  })

  test('ordered list keeps numbering from start', () => {
    expect(md('3. c\n4. d')).toBe('3. c\n4. d')
  })

  test('nested list is indented two spaces per level', () => {
    expect(md('- a\n  - b')).toBe('• a\n  • b')
  })

  test('task list items render checkboxes', () => {
    expect(md('- [ ] todo\n- [x] done')).toBe('• ☐ todo\n• ☑ done')
  })
})

describe('markdownToTelegramHtml — blocks', () => {
  test('fenced code block with language → pre/code', () => {
    expect(md('```ts\nconst x = 1\n```')).toBe(
      '<pre><code class="language-ts">const x = 1</code></pre>',
    )
  })

  test('plain fenced code block → bare pre', () => {
    expect(md('```\nhi\n```')).toBe('<pre>hi</pre>')
  })

  test('code block content is escaped', () => {
    expect(md('```\n<a> & <b>\n```')).toBe('<pre>&lt;a&gt; &amp; &lt;b&gt;</pre>')
  })

  test('blockquote wraps in <blockquote>', () => {
    expect(md('> quoted')).toBe('<blockquote>quoted</blockquote>')
  })

  test('horizontal rule becomes a box-char line', () => {
    expect(md('---')).toBe('──────────')
  })

  test('paragraphs are separated by a blank line', () => {
    expect(md('one\n\ntwo')).toBe('one\n\ntwo')
  })
})

describe('markdownToTelegramHtml — tables', () => {
  test('renders as an aligned monospace <pre> block', () => {
    const table = [
      '| Name | Status |',
      '|------|--------|',
      '| build | green |',
      '| x | pending |',
    ].join('\n')
    expect(md(table)).toBe('<pre>Name   Status\nbuild  green\nx      pending</pre>')
  })

  test('table cell special chars are escaped', () => {
    const table = ['| A | B |', '|---|---|', '| <x> | y&z |'].join('\n')
    expect(md(table)).toBe('<pre>A    B\n&lt;x&gt;  y&amp;z</pre>')
  })
})

describe('splitTelegramHtml', () => {
  test('short input is a single chunk', () => {
    expect(splitTelegramHtml('hello', 100)).toEqual(['hello'])
  })

  test('empty input yields no chunks', () => {
    expect(splitTelegramHtml('', 100)).toEqual([])
  })

  test('splits long plain text into <= budget chunks at whitespace', () => {
    const words = Array.from({ length: 50 }, (_, i) => `word${i}`).join(' ')
    const chunks = splitTelegramHtml(words, 60)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(60)
    // Reassembling (chunks were cut on spaces) reproduces the words.
    expect(chunks.join(' ').split(/\s+/).filter(Boolean)).toEqual(words.split(' '))
  })

  test('a split inside a bold run re-balances the tag on both chunks', () => {
    const html = `<b>${'x'.repeat(80)}</b>`
    const chunks = splitTelegramHtml(html, 50)
    expect(chunks.length).toBeGreaterThan(1)
    // Every chunk opens and closes <b> on its own — no orphaned entity.
    for (const c of chunks) {
      expect(c.startsWith('<b>')).toBe(true)
      expect(c.endsWith('</b>')).toBe(true)
    }
  })

  test('a split inside a <pre> block stays balanced', () => {
    const html = `<pre>${Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')}</pre>`
    const chunks = splitTelegramHtml(html, 60)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(c.startsWith('<pre>')).toBe(true)
      expect(c.endsWith('</pre>')).toBe(true)
    }
  })

  test('default budget is the safe budget constant', () => {
    expect(renderTelegramMessages('hi')).toEqual(['hi'])
    expect(TELEGRAM_SAFE_BUDGET).toBe(3900)
  })
})

describe('stripTelegramHtml', () => {
  test('removes tags and unescapes entities (parse-error fallback)', () => {
    expect(stripTelegramHtml('<b>a</b> &lt;x&gt; &amp; <code>c</code>')).toBe('a <x> & c')
  })
})
