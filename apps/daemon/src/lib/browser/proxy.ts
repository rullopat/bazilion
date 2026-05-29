// SSRF-validating forward proxy for the headless browser.
//
// Chromium is launched with `proxy: { server }` pointing here (whenever
// `allowPrivate` is off). ALL browser egress — top-level navigations,
// subresources, XHR/fetch, AND service-worker requests — flows through this
// proxy, which is what makes it strictly stronger than a `context.route`
// interceptor (those don't see service-worker traffic).
//
// For each connection we resolve DNS ourselves, reject any host that resolves
// to a loopback/private/link-local address, and then connect to that exact
// resolved IP. Because the IP we dial is the one we validated, a DNS-rebinding
// answer can't move the target to a private address between check and use —
// the time-of-check/time-of-use gap a re-resolving interceptor leaves open is
// closed here.
//
// One shared proxy per daemon (private targets are always blocked; the
// local-dev `allowPrivate` escape hatch bypasses the proxy entirely by
// launching Chromium with no proxy). Loopback-bound, lazily started, closed on
// shutdown.

import { lookup as dnsLookup } from 'node:dns/promises'
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http'
import { connect as netConnect } from 'node:net'
import type { Duplex } from 'node:stream'
import { isBlockedHostname, isPrivateIpAddress } from '../../runtime/tools/web-ssrf.ts'

let server: Server | null = null
let serverUrl: string | null = null

function stripBrackets(h: string): string {
  return h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h
}

/** Resolve a hostname to a single non-private IP, throwing if it's blocked. */
async function resolveSafeIp(hostname: string): Promise<string> {
  const host = stripBrackets(hostname.trim().toLowerCase())
  if (!host) throw new Error('empty host')
  if (isBlockedHostname(host)) throw new Error(`blocked hostname: ${host}`)
  if (isPrivateIpAddress(host)) throw new Error(`blocked private IP literal: ${host}`)
  const results = await dnsLookup(host, { all: true })
  if (results.length === 0) throw new Error(`cannot resolve: ${host}`)
  // If ANY resolved address is private, refuse — don't cherry-pick a public
  // one and risk the browser picking a private sibling on its own resolve.
  for (const r of results) {
    if (isPrivateIpAddress(r.address)) throw new Error(`${host} resolves to private IP`)
  }
  const first = results[0]
  if (!first) throw new Error(`cannot resolve: ${host}`)
  return first.address
}

/** Parse a CONNECT target ("host:port", IPv6-aware). */
function parseAuthority(authority: string): { host: string; port: number } {
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']')
    const host = authority.slice(1, end)
    const port = Number.parseInt(authority.slice(end + 2) || '443', 10)
    return { host, port }
  }
  const idx = authority.lastIndexOf(':')
  if (idx === -1) return { host: authority, port: 443 }
  return {
    host: authority.slice(0, idx),
    port: Number.parseInt(authority.slice(idx + 1), 10) || 443,
  }
}

function onConnect(req: IncomingMessage, clientSocket: Duplex, head: Buffer): void {
  const { host, port } = parseAuthority(req.url ?? '')
  resolveSafeIp(host)
    .then((ip) => {
      const upstream = netConnect(port, ip, () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head?.length) upstream.write(head)
        upstream.pipe(clientSocket)
        clientSocket.pipe(upstream)
      })
      upstream.on('error', () => clientSocket.destroy())
      clientSocket.on('error', () => upstream.destroy())
    })
    .catch(() => {
      try {
        clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      } catch {}
      clientSocket.destroy()
    })
}

function onRequest(
  clientReq: IncomingMessage,
  clientRes: import('node:http').ServerResponse,
): void {
  let target: URL
  try {
    target = new URL(clientReq.url ?? '')
  } catch {
    clientRes.writeHead(400)
    clientRes.end('bad request')
    return
  }
  resolveSafeIp(target.hostname)
    .then((ip) => {
      const upstream = httpRequest(
        {
          host: ip,
          port: Number.parseInt(target.port, 10) || 80,
          method: clientReq.method,
          path: target.pathname + target.search,
          headers: { ...clientReq.headers, host: target.host },
        },
        (upRes) => {
          clientRes.writeHead(upRes.statusCode ?? 502, upRes.headers)
          upRes.pipe(clientRes)
        },
      )
      upstream.on('error', () => {
        if (!clientRes.headersSent) clientRes.writeHead(502)
        clientRes.end()
      })
      clientReq.pipe(upstream)
    })
    .catch(() => {
      clientRes.writeHead(403)
      clientRes.end('blocked')
    })
}

/** Lazily start the proxy and return its `http://127.0.0.1:<port>` URL. */
export async function getSsrfProxy(): Promise<string> {
  if (serverUrl) return serverUrl
  const s = createServer(onRequest)
  s.on('connect', onConnect)
  await new Promise<void>((resolve, reject) => {
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      s.off('error', reject)
      resolve()
    })
  })
  const addr = s.address()
  if (!addr || typeof addr === 'string') throw new Error('proxy: failed to bind a port')
  server = s
  serverUrl = `http://127.0.0.1:${addr.port}`
  // Don't keep the daemon's event loop alive solely for the proxy.
  s.unref()
  return serverUrl
}

/** Stop the proxy (daemon shutdown). */
export async function closeSsrfProxy(): Promise<void> {
  const s = server
  server = null
  serverUrl = null
  if (!s) return
  await new Promise<void>((resolve) => s.close(() => resolve()))
}

/** Test seam: resolve+validate without going through the browser. */
export { resolveSafeIp as _resolveSafeIpForTest }
