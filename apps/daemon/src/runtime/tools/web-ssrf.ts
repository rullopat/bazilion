import { lookup as dnsLookupCb, type LookupAddress } from 'node:dns'
import { lookup as dnsLookup } from 'node:dns/promises'
import { Agent, type Dispatcher } from 'undici'

export class SsrFBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SsrFBlockedError'
  }
}

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal'])
const PRIVATE_IPV6_PREFIXES = ['fe80:', 'fec0:', 'fc', 'fd']

function normalizeHostname(hostname: string): string {
  let h = hostname.trim().toLowerCase().replace(/\.$/, '')
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
  return h
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  const nums = parts.map((p) => Number.parseInt(p, 10))
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null
  return nums
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

export function isPrivateIpAddress(address: string): boolean {
  let norm = address.trim().toLowerCase()
  if (norm.startsWith('[') && norm.endsWith(']')) norm = norm.slice(1, -1)
  if (!norm) return false
  if (norm.startsWith('::ffff:')) {
    const mapped = norm.slice('::ffff:'.length)
    const ipv4 = parseIpv4(mapped)
    if (ipv4) return isPrivateIpv4(ipv4)
  }
  if (norm.includes(':')) {
    if (norm === '::' || norm === '::1') return true
    return PRIVATE_IPV6_PREFIXES.some((p) => norm.startsWith(p))
  }
  const ipv4 = parseIpv4(norm)
  return ipv4 ? isPrivateIpv4(ipv4) : false
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
  const fetcher: FetchLike = opts.fetchImpl ?? (globalThis.fetch as FetchLike)
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
