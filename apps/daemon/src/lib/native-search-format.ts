// Diagnostic hints only. These labels never select a decoder, authorize a tool,
// establish provider identity, or prove search execution/entitlement.
export const NATIVE_BODY_PREFIX_CHARS = 1024
const MEDIA_PREFIX_CHARS = 256

export type NativeMediaType =
  | 'unknown'
  | 'missing'
  | 'sse'
  | 'json'
  | 'html'
  | 'text'
  | 'binary'
  | 'other'
export type NativeBodyFormat =
  | 'unknown'
  | 'empty'
  | 'sse_like'
  | 'json_like'
  | 'html_like'
  | 'other'

/** Inspect a bounded header prefix and return a closed label, never a raw header. */
export function classifyNativeMediaType(contentType: string | null): NativeMediaType {
  if (contentType === null || contentType === '') return 'missing'
  const prefix = contentType.slice(0, MEDIA_PREFIX_CHARS)
  const separator = prefix.indexOf(';')
  // Cannot classify an unfinished media token (including excessive leading/trailing space).
  if (separator < 0 && contentType.length > MEDIA_PREFIX_CHARS) return 'other'
  const mime = (separator < 0 ? prefix : prefix.slice(0, separator)).trim().toLowerCase()
  switch (mime) {
    case 'text/event-stream':
      return 'sse'
    case 'application/json':
      return 'json'
    case 'text/html':
    case 'application/xhtml+xml':
      return 'html'
    case 'text/plain':
      return 'text'
    case 'application/octet-stream':
      return 'binary'
    case '':
      return 'missing'
    default:
      return 'other'
  }
}

/** No HTML/JSON parsing, content extraction, keyword/anti-bot detection or body disclosure. */
export function classifyNativeBodyPrefix(body: string): NativeBodyFormat {
  if (body.length === 0) return 'empty'
  const prefix = body.slice(0, NATIVE_BODY_PREFIX_CHARS).trimStart()
  // A blank inspected prefix does not establish that the whole body is empty.
  if (!prefix) return 'unknown'
  if (/^<(?:!doctype\s+html\b|html(?=[\s>]))/i.test(prefix)) return 'html_like'
  if (prefix.startsWith('{') || prefix.startsWith('[')) return 'json_like'
  // Skip only bounded empty/comment lines, not arbitrary prose before a supposed SSE frame.
  for (const line of prefix.split('\n')) {
    if (!line.trim() || line.startsWith(':')) continue
    return /^(?:data|event|id|retry):/.test(line) ? 'sse_like' : 'other'
  }
  return 'unknown'
}
