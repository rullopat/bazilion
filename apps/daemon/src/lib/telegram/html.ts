// Telegram HTML escaping. Per the Bot API docs, only `<`, `>`, and `&` need
// to be escaped inside an HTML-parsed message body. Quotes don't (we never
// place user content inside an attribute), and Unicode is fine raw.

export function htmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
