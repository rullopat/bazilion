// Forward proxy for all managed-browser traffic (unless BROWSER_ALLOW_PRIVATE_NETWORK
// is on). It resolves every target itself, refuses loopback/private/link-local
// addresses and connects to the exact address it checked, so a DNS rebinding
// answer cannot swap in a private one. Being a proxy, it also sees service-worker
// requests, which Playwright's request interception does not.

import { lookup } from 'node:dns/promises'
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import { type AddressInfo, connect, type Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { isBlockedHostname, isPrivateIpAddress } from '../../runtime/tools/web-ssrf.ts'

let server: Server | null = null
let proxyUrl: string | null = null
let starting: Promise<string> | null = null
const sockets = new Set<Socket>()

function track(socket: Socket): void {
  if (sockets.has(socket)) return
  sockets.add(socket)
  socket.on('error', () => {}) // a reset peer must not crash the daemon
  socket.once('close', () => sockets.delete(socket))
}

/** Resolve a host to one public address; throw when it is, or resolves to, a private one. */
export async function resolvePublicAddress(hostname: string): Promise<string> {
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1')
  if (!host) throw new Error('empty host')
  if (isBlockedHostname(host)) throw new Error(`blocked hostname: ${host}`)
  if (isPrivateIpAddress(host)) throw new Error(`blocked private address: ${host}`)
  const results = await lookup(host, { all: true })
  // Refuse when ANY answer is private instead of picking a public sibling.
  const blocked = results.find((result) => isPrivateIpAddress(result.address))
  if (blocked) throw new Error(`${host} resolves to private address ${blocked.address}`)
  const first = results[0]
  if (!first) throw new Error(`cannot resolve ${host}`)
  return first.address
}

/** Split a CONNECT target ("host:port", IPv6 in brackets); null unless the port is 1-65535. */
function parseAuthority(authority: string): { host: string; port: number } | null {
  const match = /^(\[[^\]]*\]|[^:]+)(?::(\d{1,5}))?$/.exec(authority)
  if (!match?.[1]) return null
  const port = match[2] === undefined ? 443 : Number(match[2])
  return port >= 1 && port <= 65_535 ? { host: match[1], port } : null
}

// Both handlers end in .catch(): a throw inside the success path (connect() throws
// synchronously on a bad port) must answer the client, never become an unhandled
// rejection, which would exit the daemon.

function onConnect(req: IncomingMessage, client: Duplex, head: Buffer): void {
  const target = parseAuthority(req.url ?? '')
  if (!target) {
    client.end('HTTP/1.1 400 Bad Request\r\n\r\n')
    return
  }
  resolvePublicAddress(target.host)
    .then((address) => {
      const upstream = connect(target.port, address, () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length) upstream.write(head)
        upstream.pipe(client)
        client.pipe(upstream)
      })
      track(upstream)
      upstream.on('error', () => client.destroy())
      client.on('error', () => upstream.destroy())
      client.on('close', () => upstream.destroy())
    })
    .catch(() => client.end('HTTP/1.1 403 Forbidden\r\n\r\n'))
}

function onRequest(req: IncomingMessage, res: ServerResponse): void {
  let target: URL
  try {
    target = new URL(req.url ?? '')
  } catch {
    res.writeHead(400).end('bad request')
    return
  }
  resolvePublicAddress(target.hostname)
    .then((address) => {
      const upstream = httpRequest(
        {
          host: address,
          port: Number(target.port) || 80,
          method: req.method,
          path: target.pathname + target.search,
          headers: { ...req.headers, host: target.host },
        },
        (upstreamRes) => {
          res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
          upstreamRes.pipe(res)
        },
      )
      upstream.on('socket', track)
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502)
        res.end()
      })
      req.pipe(upstream)
    })
    .catch(() => {
      if (!res.headersSent) res.writeHead(403)
      res.end('blocked')
    })
}

/** The proxy URL, starting the proxy on first use (concurrent callers share one start). */
export function getSsrfProxy(): Promise<string> {
  if (proxyUrl) return Promise.resolve(proxyUrl)
  starting ??= new Promise<string>((resolve, reject) => {
    const s = createServer(onRequest)
    s.on('connect', onConnect)
    s.on('connection', track)
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      s.off('error', reject)
      s.on('error', () => {})
      s.unref() // the proxy alone does not keep the daemon alive
      server = s
      proxyUrl = `http://127.0.0.1:${(s.address() as AddressInfo).port}`
      resolve(proxyUrl)
    })
  }).finally(() => {
    starting = null
  })
  return starting
}

/** Stop the proxy, cutting every open connection (idle keep-alive clients included). */
export async function closeSsrfProxy(): Promise<void> {
  const s = server
  server = null
  proxyUrl = null
  if (!s) return
  for (const socket of sockets) socket.destroy()
  sockets.clear()
  await new Promise<void>((resolve) => s.close(() => resolve()))
}
