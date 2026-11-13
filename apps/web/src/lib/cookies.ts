// Cookie names and `Cookie` header parsing for the gateway and the browser.

/** Both CSRF cookie names; the browser cannot tell which mode the gateway runs in. */
export const CSRF_COOKIES = ['__Host-bz_csrf', 'bz_csrf_dev'] as const

/** Every value of one cookie in a `Cookie` header (or `document.cookie`); no decoding needed. */
export function cookieValues(header: string | null | undefined, name: string): string[] {
  const values: string[] = []
  for (const part of header?.split(';') ?? []) {
    const separator = part.indexOf('=')
    if (separator > 0 && part.slice(0, separator).trim() === name) {
      values.push(part.slice(separator + 1).trim())
    }
  }
  return values
}

export function readCookie(header: string | null | undefined, name: string): string | undefined {
  return cookieValues(header, name)[0]
}
