// Text helpers for browser tool results: snapshots are split into pages the
// model reads one at a time, page-controlled fields (URLs, titles, error lines)
// are clipped, and every result is capped, so a hostile page cannot flood a turn.

/** Characters per snapshot page. */
export const PAGE_CHARS = 24_000
/** The longest URL, title or error line a result quotes. */
export const FIELD_CHARS = 500
/** The cap for any browser tool text: one snapshot page with its header and a note fits. */
export const MAX_TEXT_CHARS = PAGE_CHARS + 4_000

export interface Snapshot {
  tabId: string
  url: string
  title: string
  pages: string[]
}

/** Where to cut `text` to keep at most `max` characters without splitting a surrogate pair. */
function cutAt(text: string, max: number): number {
  const last = text.charCodeAt(max - 1)
  return last >= 0xd800 && last <= 0xdbff ? max - 1 : max
}

/** Split text into pages at line breaks; a longer line is cut into page-sized pieces. */
export function splitPages(text: string, size = PAGE_CHARS): string[] {
  const pages: string[] = []
  let current = ''
  for (const line of text.split('\n')) {
    if (current && current.length + 1 + line.length > size) {
      pages.push(current)
      current = ''
    }
    let rest = current ? `${current}\n${line}` : line
    while (rest.length > size) {
      const cut = cutAt(rest, size)
      pages.push(rest.slice(0, cut))
      rest = rest.slice(cut)
    }
    current = rest
  }
  pages.push(current)
  return pages
}

/** One page-controlled field (a URL, a title, an error line), clipped to `max` characters. */
export function clip(text: string, max = FIELD_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, cutAt(text, max))}…`
}

/** Page `n` (1-based) of a snapshot, with a header saying where it came from. */
export function formatSnapshot(snapshot: Snapshot, n = 1): string {
  const total = snapshot.pages.length
  const more = n < total ? ` — read on with browser_snapshot {"page": ${n + 1}}` : ''
  return [
    `- Page URL: ${clip(snapshot.url)}`,
    `- Page title: ${clip(snapshot.title)}`,
    `- Snapshot of ${snapshot.tabId}, page ${n} of ${total}${more}`,
    '',
    snapshot.pages[n - 1] ?? '',
  ].join('\n')
}

/** Cap any browser tool text (results, console, network, tab lists, errors). */
export function capText(text: string): string {
  return text.length <= MAX_TEXT_CHARS
    ? text
    : `${text.slice(0, cutAt(text, MAX_TEXT_CHARS))}\n… (truncated)`
}
