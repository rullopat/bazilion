// SSRF-validating forward proxy for the managed browser (BAZ-069 T05).
//
// Chromium is launched pointing here (whenever `allowPrivate` is off). ALL
// browser egress — top-level navigations, subresources, XHR/fetch, AND
// service-worker requests — flows through this proxy, which is what makes it
// strictly stronger than a `context.route` interceptor (those don't see
// service-worker traffic).
//
// For each connection we resolve DNS ourselves, reject any host that resolves
// to a loopback/private/link-local address, and then connect to that exact
// resolved IP — so a DNS-rebinding answer can't move the target to a private
// address between check and use.
//
// Lifecycle (T05): one shared proxy per daemon, single-flight startup,
// every owned socket (proxied clients including idle keep-alives, upstream
// CONNECT dials, forwarded-HTTP upstreams) is tracked, and close destroys both
// sides of every connection so it settles within the D2 bound — never waiting
// for peers that may never hang up. A generation counter invalidates in-flight
// DNS resolutions and dials that span a close, so a pending lookup can never
// create an untracked socket after shutdown.
//
// Test seams (`_set*ForTest`) exist so the lane can drive bind/DNS/dial timing
// deterministically; they never weaken validation.

import { lookup as dnsLookup } from 'node:dns/promises'
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http'
import { connect as netConnect, type Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { isBlockedHostname, isPrivateIpAddress } from '../../runtime/tools/web-ssrf.ts'

let server: Server | null = null
let serverUrl: string | null = null
let pendingProxy: Promise<string> | null = null
/**
 * Incremented on every close. Handlers capture the generation when a request
 * arrives; if a close happened in between (including a close→rebind), the
 * in-flight work destroys its client side and never dials an upstream — no
 * socket may outlive the proxy generation that created its request.
 */
let proxyGeneration = 0

const trackedSockets = new Set<Socket>()

function trackSocket(socket: Socket): void {
  if (trackedSockets.has(socket)) return
  trackedSockets.add(socket)
  // A destroyed/reset peer must never crash the daemon with ECONNRESET.
  socket.on('error', () => {})
  socket.once('close', () => {
    trackedSockets.delete(socket)
  })
}

// --- test seams -----------------------------------------------------------

/** The narrow lookup shape `resolveSafeIp` needs (the real `dnsLookup` matches it). */
export interface SafeDnsResult {
  address: string
  family: number
}
export type DnsLookupFn = (hostname: string, options: { all: true }) => Promise<SafeDnsResult[]>
let dnsLookupImpl: DnsLookupFn = (hostname, options) => dnsLookup(hostname, options)
/** Override DNS resolution (e.g. gated, slow lookups); null restores the real one. */
export function _setDnsLookupForTest(fn: DnsLookupFn | null): void {
  dnsLookupImpl = fn ?? dnsLookup
}

/** How the proxy binds its listener; overridable to inject bind failures/delays. */
export type ProxyBindFn = (server: Server) => Promise<void>
const bindDefault: ProxyBindFn = (s) =>
  new Promise<void>((resolve, reject) => {
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      s.off('error', reject)
      resolve()
    })
  })
let bindImpl: ProxyBindFn = bindDefault
/** Override the bind step; null restores the real bind. */
export function _setBindForTest(fn: ProxyBindFn | null): void {
  bindImpl = fn ?? bindDefault
}

/** How upstream CONNECT tunnels are dialed; overridable to fake half-open tunnels. */
export type UpstreamDialFn = (port: number, ip: string, onConnect: () => void) => Socket
const dialDefault: UpstreamDialFn = (port, ip, onConnect) => netConnect(port, ip, onConnect)
let dialImpl: UpstreamDialFn = dialDefault
/** Override the upstream dial; null restores the real dial. */
export function _setDialForTest(fn: UpstreamDialFn | null): void {
  dialImpl = fn ?? dialDefault
}

/** Count of sockets currently owned by the proxy (asserted empty after close). */
export function _trackedSocketCountForTest(): number {
  return trackedSockets.size
}

// --- validation -----------------------------------------------------------

function stripBrackets(h: string): string {
  return h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h
}

/** Resolve a hostname to a single non-private IP, throwing if it's blocked. */
async function resolveSafeIp(hostname: string): Promise<string> {
  const host = stripBrackets(hostname.trim().toLowerCase())
  if (!host) throw new Error('empty host')
  if (isBlockedHostname(host)) throw new Error(`blocked hostname: ${host}`)
  if (isPrivateIpAddress(host)) throw new Error(`blocked private IP literal: ${host}`)
  const results = await dnsLookupImpl(host, { all: true })
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

// --- request handling -----------------------------------------------------

function onConnect(req: IncomingMessage, clientSocket: Duplex, head: Buffer): void {
  const generation = proxyGeneration
  const { host, port } = parseAuthority(req.url ?? '')
  resolveSafeIp(host)
    .then((ip) => {
      if (generation !== proxyGeneration) {
        // A close happened while DNS was pending: never dial, never leak.
        clientSocket.destroy()
        return
      }
      const upstream = dialImpl(port, ip, () => {
        if (generation !== proxyGeneration) {
          upstream.destroy()
          clientSocket.destroy()
          return
        }
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head?.length) upstream.write(head)
        upstream.pipe(clientSocket)
        clientSocket.pipe(upstream)
      })
      trackSocket(upstream as Socket)
      if (generation !== proxyGeneration) {
        upstream.destroy()
        clientSocket.destroy()
        return
      }
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
  const generation = proxyGeneration
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
      if (generation !== proxyGeneration) {
        clientRes.destroy()
        return
      }
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
      upstream.on('socket', (socket) => trackSocket(socket))
      if (generation !== proxyGeneration) {
        upstream.destroy()
        clientRes.destroy()
        return
      }
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

// --- lifecycle ------------------------------------------------------------

/**
 * Lazily start the proxy and return its `http://127.0.0.1:<port>` URL.
 * Single-flight: concurrent first callers share one bind. If a close lands
 * while the bind is pending, the proxy fails closed instead of resurrecting a
 * server after shutdown.
 */
export async function getSsrfProxy(): Promise<string> {
  if (serverUrl) return serverUrl
  if (pendingProxy) return pendingProxy
  const generation = proxyGeneration
  pendingProxy = (async () => {
    const s = createServer(onRequest)
    s.on('connect', onConnect)
    s.on('connection', (socket: Socket) => trackSocket(socket))
    await bindImpl(s)
    if (generation !== proxyGeneration) {
      await new Promise<void>((resolve) => s.close(() => resolve()))
      throw new Error('ssrf proxy was closed while starting')
    }
    const addr = s.address()
    if (!addr || typeof addr === 'string') throw new Error('proxy: failed to bind a port')
    server = s
    serverUrl = `http://127.0.0.1:${addr.port}`
    // Don't keep the daemon's event loop alive solely for the proxy.
    s.unref()
    return serverUrl
  })()
  try {
    return await pendingProxy
  } finally {
    pendingProxy = null
  }
}

/**
 * Stop the proxy. Invalidates every in-flight DNS resolution/dial of the
 * closing generation, destroys every owned socket (idle keep-alive clients and
 * half-open tunnels included) and closes the listener — settling within the
 * D2 bound instead of waiting for peers that may never hang up.
 */
export async function closeSsrfProxy(): Promise<void> {
  proxyGeneration++
  const s = server
  server = null
  serverUrl = null
  if (!s) return
  for (const socket of trackedSockets) {
    try {
      socket.destroy()
    } catch {
      // best effort: close() below still terminates the listener
    }
  }
  trackedSockets.clear()
  await new Promise<void>((resolve) => s.close(() => resolve()))
}

/** Test seam: resolve+validate without going through the browser. */
export { resolveSafeIp as _resolveSafeIpForTest }
