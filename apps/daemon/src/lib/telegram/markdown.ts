// Markdown → Telegram-HTML converter.
//
// The Web UI renders agent replies as full HTML via `marked` + DOMPurify
// (apps/web/src/lib/md.ts). Telegram can't render arbitrary HTML — it parses
// a *fixed, flat set of entities* (<b>/<i>/<u>/<s>/<code>/<pre>/<a>/<blockquote>;
// see https://core.telegram.org/bots/api#html-style). So we reuse `marked`'s
// lexer (same parse the Web UI sees) and walk the tokens into that supported
// subset, approximating the features Telegram has no entity for:
//   - headings  → emoji-prefixed bold (Telegram has no font sizing, so every
//                 level collapses to bold; the prefix glyph is the only way to
//                 hint hierarchy / set a heading apart from bold prose).
//   - lists     → manual "• " / "1. " bullets with 2-space-per-level indent
//                 (Telegram has no list entity). Task items get ☐ / ☑.
//   - tables    → a monospace <pre> block with space-padded columns (the only
//                 way to align cells, since Telegram fonts are proportional).
//   - hr        → a horizontal rule of box characters.
//
// Image *content* is delivered separately (mirror.ts sends photos/documents);
// an inline markdown image here degrades to a link.

import { marked, type Token, type Tokens } from 'marked'
import { htmlEscape } from './html.ts'

// Telegram caps a message body at 4096 chars. We budget against the *HTML*
// length (always ≥ the entity-parsed visible length Telegram actually limits),
// so staying under this is conservatively safe. 3900 leaves headroom.
export const TELEGRAM_SAFE_BUDGET = 3900

// Heading glyphs by depth — h1/h2 get a bold bar, h3+ a triangle. Purely a
// visual hint since Telegram renders them all at the same size.
function headingPrefix(depth: number): string {
  return depth <= 1 ? '▎ ' : depth === 2 ? '▸ ' : '· '
}

// Only allow link schemes Telegram accepts. A bad href would make Telegram
// reject the *entire* message ("can't parse entities"), so we strip the <a>
// and keep the visible text rather than risk losing the whole reply.
function safeHref(href: string | null | undefined): string | null {
  if (!href) return null
  if (!/^(https?:|tg:|mailto:)/i.test(href.trim())) return null
  // Quotes can't appear unescaped inside the double-quoted attribute.
  return htmlEscape(href).replaceAll('"', '%22')
}

/** Render inline tokens to Telegram HTML. */
function renderInline(tokens: Token[] | undefined): string {
  if (!tokens) return ''
  let out = ''
  for (const t of tokens) {
    switch (t.type) {
      case 'text': {
        const tok = t as Tokens.Text
        out += tok.tokens ? renderInline(tok.tokens) : htmlEscape(tok.text)
        break
      }
      case 'escape':
        out += htmlEscape((t as Tokens.Escape).text)
        break
      case 'strong':
        out += `<b>${renderInline((t as Tokens.Strong).tokens)}</b>`
        break
      case 'em':
        out += `<i>${renderInline((t as Tokens.Em).tokens)}</i>`
        break
      case 'del':
        out += `<s>${renderInline((t as Tokens.Del).tokens)}</s>`
        break
      case 'codespan':
        out += `<code>${htmlEscape((t as Tokens.Codespan).text)}</code>`
        break
      case 'br':
        out += '\n'
        break
      case 'link': {
        const tok = t as Tokens.Link
        const href = safeHref(tok.href)
        const inner = renderInline(tok.tokens)
        out += href ? `<a href="${href}">${inner}</a>` : inner
        break
      }
      case 'image': {
        const tok = t as Tokens.Image
        const href = safeHref(tok.href)
        const label = htmlEscape(tok.text || tok.href || '')
        out += href ? `<a href="${href}">${label}</a>` : label
        break
      }
      case 'html':
        // Raw inline HTML from the model — Telegram only knows its own tag
        // set, so emit it as literal text rather than risk a parse error.
        out += htmlEscape((t as Tokens.HTML).text)
        break
      default: {
        const raw = (t as { raw?: string }).raw
        out += raw ? htmlEscape(raw) : ''
      }
    }
  }
  return out
}

/** Flatten inline tokens to plain (unescaped) text — for table-cell sizing. */
function plainInline(tokens: Token[] | undefined): string {
  if (!tokens) return ''
  let out = ''
  for (const t of tokens) {
    const tok = t as { type: string; tokens?: Token[]; text?: string }
    if (tok.type === 'br') out += ' '
    else if (tok.tokens) out += plainInline(tok.tokens)
    else if (typeof tok.text === 'string') out += tok.text
  }
  return out.trim()
}

function renderList(token: Tokens.List, indent: number): string {
  const pad = '  '.repeat(indent)
  const lines: string[] = []
  token.items.forEach((item, idx) => {
    const bullet = token.ordered ? `${Number(token.start || 1) + idx}. ` : '• '
    const task = item.task ? (item.checked ? '☑ ' : '☐ ') : ''
    const nested: string[] = []
    let inline = ''
    for (const child of item.tokens) {
      if (child.type === 'list') {
        nested.push(renderList(child as Tokens.List, indent + 1))
      } else if (child.type === 'text' || child.type === 'paragraph') {
        inline += renderInline((child as Tokens.Text | Tokens.Paragraph).tokens)
      } else {
        inline += renderInline([child])
      }
    }
    // marked flags the item as a task but leaves the literal `[ ]`/`[x]`
    // marker in the text — drop it (we render the box via `task` above).
    if (item.task) inline = inline.replace(/^\s*\[[ xX]\]\s+/, '')
    // Indent any wrapped/soft-broken lines under the bullet text.
    const body = inline.replaceAll('\n', `\n${pad}   `)
    lines.push(`${pad}${bullet}${task}${body}`)
    lines.push(...nested)
  })
  return lines.join('\n')
}

function renderTable(token: Tokens.Table): string {
  const headers = token.header.map((c) => plainInline(c.tokens))
  const rows = token.rows.map((r) => r.map((c) => plainInline(c.tokens)))
  const cols = headers.length
  const widths: number[] = []
  for (let c = 0; c < cols; c++) {
    let w = headers[c]?.length ?? 0
    for (const row of rows) w = Math.max(w, row[c]?.length ?? 0)
    widths[c] = w
  }
  const fmt = (cells: string[]): string =>
    cells
      .map((cell, c) => (c === cols - 1 ? cell : cell.padEnd(widths[c] ?? 0)))
      .join('  ')
      .trimEnd()
  const body = [fmt(headers), ...rows.map(fmt)].map(htmlEscape).join('\n')
  return `<pre>${body}</pre>`
}

function renderBlock(token: Token): string {
  switch (token.type) {
    case 'heading': {
      const tok = token as Tokens.Heading
      return `${headingPrefix(tok.depth)}<b>${renderInline(tok.tokens)}</b>`
    }
    case 'paragraph':
      return renderInline((token as Tokens.Paragraph).tokens)
    case 'text': {
      const tok = token as Tokens.Text
      return tok.tokens ? renderInline(tok.tokens) : htmlEscape(tok.text)
    }
    case 'code': {
      const tok = token as Tokens.Code
      const lang = tok.lang ? tok.lang.split(/\s+/)[0] : ''
      const body = htmlEscape(tok.text)
      return lang
        ? `<pre><code class="language-${htmlEscape(lang)}">${body}</code></pre>`
        : `<pre>${body}</pre>`
    }
    case 'blockquote':
      return `<blockquote>${renderBlocks((token as Tokens.Blockquote).tokens)}</blockquote>`
    case 'list':
      return renderList(token as Tokens.List, 0)
    case 'table':
      return renderTable(token as Tokens.Table)
    case 'hr':
      return '──────────'
    case 'html':
      return htmlEscape((token as Tokens.HTML).text).trim()
    case 'space':
      return ''
    default: {
      const tok = token as Tokens.Generic
      return tok.tokens ? renderBlocks(tok.tokens as Token[]) : ''
    }
  }
}

function renderBlocks(tokens: Token[]): string {
  return tokens
    .map(renderBlock)
    .filter((s) => s.length > 0)
    .join('\n\n')
}

/** Convert agent Markdown to a single Telegram-HTML string. */
export function markdownToTelegramHtml(text: string): string {
  return renderBlocks(marked.lexer(text)).trim()
}

// ─── chunk splitting ────────────────────────────────────────────────────
//
// Telegram rejects bodies > 4096 chars, so a long reply must be split into
// several messages. We can't cut blindly — a cut inside `<b>…</b>` or a
// `<pre>` block would leave an unbalanced entity and Telegram would 400 the
// whole message. So the splitter is tag-aware: it tracks the open-tag stack
// and, at every chunk boundary, closes the open tags on the tail of one chunk
// and re-opens them on the head of the next. A split inside a code block thus
// becomes `…</pre>` + `<pre>…`, which renders as two valid blocks.

interface OpenTag {
  name: string
  full: string
}

function closingFor(open: OpenTag[]): string {
  let s = ''
  for (let i = open.length - 1; i >= 0; i--) s += `</${open[i]?.name}>`
  return s
}

function reopenFor(open: OpenTag[]): string {
  return open.map((o) => o.full).join('')
}

/** Split Telegram HTML into <= budget chunks, keeping every entity balanced. */
export function splitTelegramHtml(html: string, budget = TELEGRAM_SAFE_BUDGET): string[] {
  if (html.length <= budget) return html.length ? [html] : []

  const atoms: ({ tag: true; full: string } | { tag: false; text: string })[] = []
  const tagRe = /<\/?[a-zA-Z][^>]*>/g
  let last = 0
  let m: RegExpExecArray | null
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex-exec loop
  while ((m = tagRe.exec(html)) !== null) {
    if (m.index > last) atoms.push({ tag: false, text: html.slice(last, m.index) })
    atoms.push({ tag: true, full: m[0] })
    last = m.index + m[0].length
  }
  if (last < html.length) atoms.push({ tag: false, text: html.slice(last) })

  const chunks: string[] = []
  const open: OpenTag[] = []
  let chunk = ''

  const flush = (): void => {
    if (!chunk) return
    chunks.push(chunk + closingFor(open))
    chunk = reopenFor(open)
  }

  for (const atom of atoms) {
    if (atom.tag) {
      chunk += atom.full
      if (atom.full.startsWith('</')) {
        open.pop()
      } else {
        const name = atom.full.slice(1).match(/^[a-zA-Z]+/)?.[0] ?? ''
        open.push({ name, full: atom.full })
      }
      continue
    }
    let text = atom.text
    while (text) {
      const room = budget - chunk.length - closingFor(open).length
      if (text.length <= room) {
        chunk += text
        break
      }
      if (room <= 0) {
        flush()
        continue
      }
      const head = text.slice(0, room)
      // Prefer to break at the last whitespace so we don't slice a word; only
      // honor it if it's not pathologically early (keeps chunks reasonably full).
      const ws = Math.max(head.lastIndexOf('\n'), head.lastIndexOf(' '))
      const cut = ws > room * 0.5 ? ws + 1 : room
      chunk += text.slice(0, cut)
      text = text.slice(cut)
      flush()
    }
  }
  if (chunk && chunk !== reopenFor(open)) chunks.push(chunk + closingFor(open))
  return chunks
}

/** Convert agent Markdown to one or more send-ready Telegram-HTML chunks. */
export function renderTelegramMessages(text: string, budget = TELEGRAM_SAFE_BUDGET): string[] {
  return splitTelegramHtml(markdownToTelegramHtml(text), budget)
}

/**
 * Strip Telegram HTML back to plain text — the fallback when a `parse_mode:
 * HTML` send is rejected, so a converter glitch never drops the reply.
 */
export function stripTelegramHtml(html: string): string {
  return html
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}
