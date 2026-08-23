import { lookup as dnsLookupCb, type LookupAddress } from 'node:dns'
import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { Agent, type Dispatcher, fetch as undiciFetch } from 'undici'

export class SsrFBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SsrFBlockedError'
  }
}

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal'])

function normalizeHostname(hostname: string): string {
  let h = hostname.trim().toLowerCase().replace(/\.$/, '')
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
  return h
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null
  const nums = parts.map(Number)
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null
  return nums
}

function parseIpv6(address: string): number[] | null {
  const zoneIndex = address.indexOf('%')
  let source = zoneIndex === -1 ? address : address.slice(0, zoneIndex)
  if (isIP(source) !== 6) return null

  if (source.includes('.')) {
    const separator = source.lastIndexOf(':')
    const ipv4 = parseIpv4(source.slice(separator + 1))
    if (separator === -1 || !ipv4) return null
    const [a, b, c, d] = ipv4 as [number, number, number, number]
    source = `${source.slice(0, separator)}:${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }

  const halves = source.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  const omitted = 8 - left.length - right.length
  if ((halves.length === 1 && omitted !== 0) || (halves.length === 2 && omitted < 1)) return null
  return [...left, ...Array.from({ length: omitted }, () => '0'), ...right].map((word) =>
    Number.parseInt(word, 16),
  )
}

function isPrivateIpv4(parts: number[]): boolean {
  const [a, b] = parts as [number, number, number, number]
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

function embeddedIpv4(words: number[]): number[] | null {
  const [a, b, c, d, e, f, g, h] = words as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  const low32 = [g >> 8, g & 0xff, h >> 8, h & 0xff]

  // IPv4-compatible (::/96), IPv4-mapped (::ffff:0:0/96), and the
  // historical IPv4-translatable (::ffff:0:0:0/96) representations.
  if (
    (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0) ||
    (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff) ||
    (a === 0 && b === 0 && c === 0 && d === 0 && e === 0xffff && f === 0)
  ) {
    return low32
  }

  // RFC 6052's well-known /96 NAT64 prefix.
  if (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) {
    return low32
  }

  // RFC 8215's local-use /48 translation prefix. With a /48 prefix, the
  // IPv4 octets occupy bytes 6, 7, 9, and 10; byte 8 is the reserved u byte.
  if (a === 0x64 && b === 0xff9b && c === 1 && e >> 8 === 0) {
    return [d >> 8, d & 0xff, e & 0xff, f >> 8]
  }

  // 6to4 embeds its IPv4 relay address immediately after 2002::/16.
  if (a === 0x2002) return [b >> 8, b & 0xff, c >> 8, c & 0xff]
  return null
}

export function isPrivateIpAddress(address: string): boolean {
  let norm = address.trim().toLowerCase()
  if (norm.startsWith('[') && norm.endsWith(']')) norm = norm.slice(1, -1)
  if (!norm) return false
  const ipv4 = parseIpv4(norm)
  if (ipv4) return isPrivateIpv4(ipv4)
  const words = parseIpv6(norm)
  if (!words) return false
  const [first] = words as [number, ...number[]]
  if (words.every((word) => word === 0)) return true
  if (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) return true
  if ((first & 0xfe00) === 0xfc00) return true // fc00::/7 unique-local
  if ((first & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return true // fec0::/10 deprecated site-local
  if ((first & 0xff00) === 0xff00) return true // ff00::/8 multicast
  const embedded = embeddedIpv4(words)
  return embedded ? isPrivateIpv4(embedded) : false
}

export function isBlockedHostname(hostname: string): boolean {
  const h = normalizeHostname(hostname)
  if (!h) return false
  if (BLOCKED_HOSTNAMES.has(h)) return true
  return h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void

function createPinnedLookup(hostname: string, addresses: string[]): typeof dnsLookupCb {
  const normalized = normalizeHostname(hostname)
  const records = addresses.map((address) => ({
    address,
    family: (address.includes(':') ? 6 : 4) as 4 | 6,
  }))
  let index = 0
  return ((host: string, options?: unknown, callback?: unknown) => {
    const cb: LookupCallback =
      typeof options === 'function' ? (options as LookupCallback) : (callback as LookupCallback)
    if (!cb) return
    if (normalizeHostname(host) !== normalized) {
      if (typeof options === 'function' || options === undefined) {
        return (dnsLookupCb as unknown as (h: string, cb: LookupCallback) => void)(host, cb)
      }
      return (dnsLookupCb as unknown as (h: string, o: unknown, cb: LookupCallback) => void)(
        host,
        options,
        cb,
      )
    }
    const opts =
      typeof options === 'object' && options !== null
        ? (options as { all?: boolean; family?: number })
        : {}
    const family = typeof options === 'number' ? options : (opts.family ?? 0)
    const candidates =
      family === 4 || family === 6 ? records.filter((r) => r.family === family) : records
    const usable = candidates.length > 0 ? candidates : records
    if (opts.all) {
      cb(null, usable as LookupAddress[])
      return
    }
    const chosen = usable[index % usable.length]
    if (!chosen) return
    index += 1
    cb(null, chosen.address, chosen.family)
  }) as typeof dnsLookupCb
}

async function resolveAndCheck(hostname: string): Promise<string[]> {
  const norm = normalizeHostname(hostname)
  if (!norm) throw new SsrFBlockedError('Invalid hostname')
  if (isBlockedHostname(norm)) throw new SsrFBlockedError(`Blocked hostname: ${hostname}`)
  if (isPrivateIpAddress(norm)) throw new SsrFBlockedError('Blocked: private IP literal')
  const results = await dnsLookup(norm, { all: true })
  if (results.length === 0) throw new SsrFBlockedError(`Cannot resolve: ${hostname}`)
  for (const r of results) {
    if (isPrivateIpAddress(r.address)) throw new SsrFBlockedError('Blocked: resolves to private IP')
  }
  return Array.from(new Set(results.map((r) => r.address)))
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

export interface GuardedFetchOptions {
  url: string
  fetchImpl?: FetchLike
  init?: RequestInit
  maxRedirects?: number
  timeoutMs?: number
  signal?: AbortSignal
  /** If true, skip all SSRF checks (for tests hitting 127.0.0.1 mocks). */
  allowPrivate?: boolean
}

export interface GuardedFetchResult {
  response: Response
  finalUrl: string
  release: () => Promise<void>
}

function isRedirectStatus(s: number): boolean {
  return s === 301 || s === 302 || s === 303 || s === 307 || s === 308
}

async function closeDispatcher(d: Dispatcher | null): Promise<void> {
  if (!d) return
  try {
    await d.close()
  } catch {
    // ignore
  }
}

export async function guardedFetch(opts: GuardedFetchOptions): Promise<GuardedFetchResult> {
  // Use undici's own fetch (not globalThis.fetch) so the `dispatcher` Agent
  // we attach below is the same undici major version as the fetch impl
  // consuming it. Node 24 ships undici 7.x as its built-in fetch; mixing
  // a standalone undici 8.x Agent with the 7.x dispatcher fails with
  // `UND_ERR_INVALID_ARG: invalid onRequestStart method` because the
  // diagnostics-channel handler signatures changed between majors.
  const fetcher: FetchLike = opts.fetchImpl ?? (undiciFetch as unknown as FetchLike)
  const maxRedirects = opts.maxRedirects ?? 3
  const abortController = new AbortController()
  const timeoutId = opts.timeoutMs
    ? setTimeout(() => abortController.abort(new Error('timeout')), opts.timeoutMs)
    : null
  if (opts.signal) {
    if (opts.signal.aborted) abortController.abort(opts.signal.reason)
    else
      opts.signal.addEventListener('abort', () => abortController.abort(opts.signal?.reason), {
        once: true,
      })
  }

  let current = opts.url
  const visited = new Set<string>()
  let redirects = 0
  let dispatcher: Dispatcher | null = null

  const release = async (): Promise<void> => {
    if (timeoutId) clearTimeout(timeoutId)
    await closeDispatcher(dispatcher)
    dispatcher = null
  }

  while (true) {
    let parsed: URL
    try {
      parsed = new URL(current)
    } catch {
      await release()
      throw new Error('Invalid URL')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      await release()
      throw new Error('Invalid URL: must be http or https')
    }

    // Pin DNS only when we control the dispatcher (native fetch path).
    const canPin = !opts.fetchImpl
    if (!opts.allowPrivate) {
      const addrs = await resolveAndCheck(parsed.hostname)
      await closeDispatcher(dispatcher)
      dispatcher = canPin
        ? new Agent({ connect: { lookup: createPinnedLookup(parsed.hostname, addrs) } })
        : null
    }

    const init: RequestInit = {
      ...(opts.init ?? {}),
      redirect: 'manual',
      signal: abortController.signal,
    }
    // `dispatcher` is a Node fetch extension not reflected in the DOM
    // RequestInit type — and the undici Dispatcher type brand can diverge
    // from the one @types/node bundles. Stamp it on via a cast.
    if (dispatcher) (init as unknown as { dispatcher: Dispatcher }).dispatcher = dispatcher

    let res: Response
    try {
      res = await fetcher(parsed.toString(), init)
    } catch (err) {
      await release()
      throw err
    }

    if (isRedirectStatus(res.status)) {
      const loc = res.headers.get('location')
      if (!loc) {
        await release()
        throw new Error(`Redirect ${res.status} missing Location header`)
      }
      redirects += 1
      if (redirects > maxRedirects) {
        await release()
        throw new Error(`Too many redirects (> ${maxRedirects})`)
      }
      const next = new URL(loc, parsed).toString()
      if (visited.has(next)) {
        await release()
        throw new Error('Redirect loop')
      }
      visited.add(next)
      void res.body?.cancel()
      current = next
      continue
    }

    return { response: res, finalUrl: parsed.toString(), release }
  }
}
