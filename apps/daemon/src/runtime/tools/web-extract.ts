import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'

export type ExtractMode = 'markdown' | 'text'

export interface ExtractResult {
  text: string
  title?: string
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/gi, (_, dec) => String.fromCharCode(Number.parseInt(dec, 10)))
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ''))
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function htmlToMarkdown(html: string): { text: string; title?: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? normalizeWhitespace(stripTags(titleMatch[1] ?? '')) : undefined
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
  text = text.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, body) => {
    const label = normalizeWhitespace(stripTags(body))
    return label ? `[${label}](${href})` : href
  })
  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, body) => {
    const n = Math.max(1, Math.min(6, Number.parseInt(level, 10)))
    return `\n${'#'.repeat(n)} ${normalizeWhitespace(stripTags(body))}\n`
  })
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, body) => {
    const label = normalizeWhitespace(stripTags(body))
    return label ? `\n- ${label}` : ''
  })
  text = text
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|tr|ul|ol|table|blockquote)>/gi, '\n')
  text = stripTags(text)
  return { text: normalizeWhitespace(text), title }
}

function markdownToPlain(md: string): string {
  let t = md
  t = t.replace(/!\[[^\]]*]\([^)]+\)/g, '')
  t = t.replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
  t = t.replace(/```[\s\S]*?```/g, (block) =>
    block.replace(/```[^\n]*\n?/g, '').replace(/```/g, ''),
  )
  t = t.replace(/`([^`]+)`/g, '$1')
  t = t.replace(/^#{1,6}\s+/gm, '')
  t = t.replace(/^\s*[-*+]\s+/gm, '')
  t = t.replace(/^\s*\d+\.\s+/gm, '')
  return normalizeWhitespace(t)
}

/**
 * Extract readable content from HTML using Readability, with a regex-based
 * markdown fallback when Readability can't identify an article.
 */
export function extractReadable(html: string, url: string, mode: ExtractMode): ExtractResult {
  const fallback = (): ExtractResult => {
    const r = htmlToMarkdown(html)
    return mode === 'text' ? { text: markdownToPlain(r.text), title: r.title } : r
  }
  try {
    const { document } = parseHTML(html)
    try {
      ;(document as unknown as { baseURI?: string }).baseURI = url
    } catch {
      // best-effort
    }
    type ReadabilityArg = ConstructorParameters<typeof Readability>[0]
    const parsed = new Readability(document as unknown as ReadabilityArg, {
      charThreshold: 0,
    }).parse()
    if (!parsed?.content) return fallback()
    const title = parsed.title || undefined
    if (mode === 'text') {
      const text = normalizeWhitespace(parsed.textContent ?? '')
      return text ? { text, title } : fallback()
    }
    const rendered = htmlToMarkdown(parsed.content)
    return { text: rendered.text, title: title ?? rendered.title }
  } catch {
    return fallback()
  }
}
