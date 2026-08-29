// Markdown rendering for chat output. marked produces HTML; DOMPurify strips
// any <script>, <iframe>, event handlers, and javascript: URIs. The LLM can
// emit arbitrary text — a prompt-injected response or a tool output echoing
// untrusted content could otherwise execute in this tab.

import DOMPurify from 'dompurify'
import { marked } from 'marked'

let installed = false

function install(): void {
  if (installed) return
  marked.setOptions({ breaks: true, gfm: true })
  // Route every rendered <a> through a new tab. Clicking a link mid-stream in
  // the same tab aborts the fetch and loses the in-flight turn; target=_blank
  // + rel=noopener noreferrer keeps the chat alive and follows the standard
  // security recommendation for user-content links.
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName === 'A') {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })
  installed = true
}

export function renderMd(text: string, domReady: boolean): string {
  if (!text) return ''
  if (!domReady || typeof window === 'undefined') {
    // DOMPurify needs a DOM. SSR and the browser's hydration pass both use
    // this escaped representation; ChatPane upgrades it after hydration.
    return escapeHtml(text)
  }
  try {
    install()
    const html = marked.parse(text, { async: false }) as string
    return DOMPurify.sanitize(html)
  } catch {
    return escapeHtml(text)
  }
}

export function escapeHtml(s: string): string {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
