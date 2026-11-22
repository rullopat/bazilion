// Markdown read as plain text, for a title and a one-line preview of a note: "Voice" and "Short
// sentences. Friendly, never cute.", not "# Voice Short sentences…".

/** A line with its block marks (heading, quote, list bullet, task box) taken off. */
function blockText(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
}

/**
 * Inline marks taken off a paragraph: links and images keep their text, code its content, and
 * emphasis its words. Emphasis needs a word right inside its marks, as Markdown does, so
 * `2 * 3 * 4` and `__init__.py` stay as they are.
 */
function inlineText(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(^|[^\w*])\*\*([^*\s](?:.*?[^*\s])?)\*\*(?![\w*])/g, '$1$2')
    .replace(/(^|[^\w_])__([^_\s](?:.*?[^_\s])?)__(?![\w_.])/g, '$1$2')
    .replace(/(^|[^\w*])\*([^*\s](?:[^*]*?[^*\s])?)\*(?![\w*])/g, '$1$2')
    .replace(/(^|[^\w_])_([^_\s](?:[^_]*?[^_\s])?)_(?![\w_])/g, '$1$2')
    .replace(/~~(\S(?:.*?\S)?)~~/g, '$1')
}

const isRule = (line: string) => /^\s*([-*_])(\s*\1){2,}\s*$/.test(line)
const isHeading = (line: string) => /^\s{0,3}#{1,6}\s/.test(line)
/** The marker a fenced code block opens with, ``` or ~~~ (or longer). */
const fenceOf = (line: string) => /^\s*(`{3,}|~{3,})/.exec(line)?.[1] ?? null
/** A search hit's position, as the memory index writes it: `@@ -4,4 @@`. */
const HIT_HEADER = /^\s*@@[^@]*@@\s*/

/** The note's first heading, as text; null when it starts without one. */
export function markdownTitle(markdown: string): string | null {
  for (const raw of markdown.split('\n')) {
    const line = raw.replace(HIT_HEADER, '')
    if (!line.trim()) continue
    const heading = /^\s{0,3}#{1,6}\s+(.+)$/.exec(line)
    return heading?.[1] ? inlineText(heading[1]).trim() || null : null
  }
  return null
}

/**
 * The note's text without its headings, as one line of plain words, cut at `max` characters on a
 * word. Code blocks and rules are left out.
 */
export function markdownPreview(markdown: string, max = 140): string {
  const paragraphs: string[] = []
  let current: string[] = []
  let fence: string | null = null
  const close = () => {
    if (current.length) paragraphs.push(inlineText(current.join(' ')))
    current = []
  }
  for (const raw of markdown.split('\n')) {
    const line = raw.replace(HIT_HEADER, '')
    const marker = fenceOf(line)
    if (fence) {
      // A block closes only on a fence of its own kind, at least as long.
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null
      continue
    }
    if (marker) {
      close()
      fence = marker
      continue
    }
    if (!line.trim() || isRule(line) || isHeading(line)) {
      close()
      continue
    }
    // A list item is a paragraph of its own.
    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) close()
    current.push(blockText(line).trim())
    if (paragraphs.join(' ').length > max) break
  }
  close()
  const text = paragraphs.join(' ').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–-]+$/, '')}…`
}
