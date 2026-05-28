// SSRF guard for the headless browser.
//
// `web_fetch` routes through undici with a pinned-DNS dispatcher (see
// `runtime/tools/web-ssrf.ts`). A headless browser bypasses all of that — it
// opens its own sockets — so we re-apply the same loopback/private/link-local
// classification at the Playwright `context.route` layer. Every navigation and
// subresource request is screened before it leaves the machine.
//
// Unless `allowPrivate` is set (local-dev escape hatch), a request to a
// blocked hostname, a private IP literal, or a hostname that *resolves* to a
// private IP is aborted. The DNS re-resolution closes the rebinding hole the
// browser would otherwise open.

import { lookup as dnsLookup } from 'node:dns/promises'
import { isBlockedHostname, isPrivateIpAddress } from '../../runtime/tools/web-ssrf.ts'

/**
 * Schemes that stay inside the browser and never touch the disk or network.
 * `file:` is deliberately NOT here — it reads local disk and must be blocked.
 */
const SAFE_NON_HTTP_SCHEMES = new Set(['about:', 'data:', 'blob:'])

/**
 * Decide whether a URL must be blocked. Returns a reason string when blocked,
 * or `null` when the request may proceed. Only http(s) reach the IP checks;
 * other schemes are allowed only if they're known-safe in-browser ones —
 * `file:`, `chrome:`, `view-source:`, etc. are blocked so the browser can't be
 * pointed at local disk or privileged pages.
 */
export async function browserBlockReason(
  rawUrl: string,
  allowPrivate: boolean,
): Promise<string | null> {
  if (allowPrivate) return null
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null // let Playwright reject malformed URLs itself
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return SAFE_NON_HTTP_SCHEMES.has(url.protocol) ? null : `blocked URL scheme: ${url.protocol}`
  }

  const host = url.hostname
  if (isBlockedHostname(host)) return `blocked hostname: ${host}`
  if (isPrivateIpAddress(host)) return `blocked private IP literal: ${host}`

  // Hostname → resolve and re-check every address (anti-rebinding).
  try {
    const results = await dnsLookup(host, { all: true })
    for (const r of results) {
      if (isPrivateIpAddress(r.address)) {
        return `${host} resolves to private IP ${r.address}`
      }
    }
  } catch {
    // Resolution failure: let the browser surface its own DNS error rather
    // than masking it as an SSRF block.
    return null
  }
  return null
}
