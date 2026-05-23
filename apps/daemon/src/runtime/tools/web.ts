import { fetch as undiciFetch } from 'undici'
import type { ToolHandler } from './types.ts'
import {
  type ExtractMode,
  type ExtractResult,
  extractReadable,
  markdownToPlain,
} from './web-extract.ts'
import { guardedFetch, SsrFBlockedError } from './web-ssrf.ts'

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
const DEFAULT_CACHE_TTL_MS = 15 * 60_000
const DEFAULT_CACHE_MAX = 100
const DEFAULT_MAX_LENGTH = 20_000
const DEFAULT_TIMEOUT_MS = 30_000
// Raw body cap applied before parsing. Multi-megabyte HTML (Mintlify/Next.js
// docs sites, ad-heavy pages) can stall or OOM Readability+linkedom's
// synchronous DOM walk. 3 MB comfortably covers real articles; anything
// larger gets truncated and the caller sees a note in the output.
const DEFAULT_MAX_BODY_BYTES = 3 * 1024 * 1024
// If the primary Readability path returns fewer than this many characters
// from a 2xx HTML response, and FIRECRAWL_API_KEY is configured, retry the
// fetch via Firecrawl which renders JS server-side. Threshold is heuristic:
// real articles routinely exceed 200 chars; pages that bottom out below it
// are almost always JS-shell pages where extraction collapsed.
const FIRECRAWL_FALLBACK_THRESHOLD = 200
const FIRECRAWL_DEFAULT_URL = 'https://api.firecrawl.dev'

interface SearchResult {
  title: string
  url: string
  snippet: string
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

// --- search backends ---

async function braveSearch(
  query: string,
  limit: number,
  apiKey: string,
  fetchFn: typeof fetch,
): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, count: String(limit) })
  const res = await fetchFn(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: {
      accept: 'application/json',
      'accept-encoding': 'gzip',
      'x-subscription-token': apiKey,
    },
  })
  if (!res.ok) throw new Error(`Brave Search: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as {
    web?: { results?: { title?: string; url?: string; description?: string }[] }
  }
  return (data.web?.results ?? []).slice(0, limit).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.description ? stripHtml(r.description) : '',
  }))
}

async function searxngSearch(
  query: string,
  limit: number,
  baseURL: string,
  fetchFn: typeof fetch,
): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, format: 'json' })
  const res = await fetchFn(`${baseURL}/search?${params}`, {
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`SearXNG: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as {
    results?: { title?: string; url?: string; content?: string }[]
  }
  return (data.results ?? []).slice(0, limit).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.content ?? '',
  }))
}

// --- error formatting ---

/**
 * Flatten an Error and its `cause` chain into a single readable string.
 * undici surfaces network failures as `TypeError: fetch failed` with the
 * real reason (UND_ERR_*, ECONNRESET, certificate errors, …) stashed in
 * `err.cause`; without unwrapping it the agent only ever sees "fetch
 * failed" and has no path to diagnose or work around the problem.
 */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const parts: string[] = []
  const seen = new Set<unknown>()
  let cur: unknown = err
  while (cur instanceof Error && !seen.has(cur)) {
    seen.add(cur)
    const code = (cur as { code?: string }).code
    parts.push(code ? `[${code}] ${cur.message}` : cur.message)
    cur = (cur as { cause?: unknown }).cause
  }
  return parts.join(' — cause: ')
}

// --- bounded body reader ---

/**
 * Stream `res.body` and accumulate up to `maxBytes`, then truncate. Returns
 * the decoded text (using the charset from content-type, falling back to
 * UTF-8) and a flag the caller can surface to the agent so it knows the
 * page was larger than the cap.
 */
async function readBodyCapped(
  res: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const ct = res.headers.get('content-type') ?? ''
  const charset = /charset=([^;]+)/i.exec(ct)?.[1]?.trim().toLowerCase() || 'utf-8'
  const decoder = new TextDecoder(charset, { fatal: false })
  const reader = res.body?.getReader()
  if (!reader) {
    const text = await res.text()
    if (text.length > maxBytes) return { text: text.slice(0, maxBytes), truncated: true }
    return { text, truncated: false }
  }
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (!value) continue
    if (total + value.byteLength > maxBytes) {
      const keep = maxBytes - total
      if (keep > 0) chunks.push(value.subarray(0, keep))
      truncated = true
      try {
        await reader.cancel()
      } catch {
        // body already settled
      }
      break
    }
    chunks.push(value)
    total += value.byteLength
  }
  const sum = chunks.reduce((s, c) => s + c.byteLength, 0)
  const merged = new Uint8Array(sum)
  let off = 0
  for (const c of chunks) {
    merged.set(c, off)
    off += c.byteLength
  }
  return { text: decoder.decode(merged), truncated }
}

// --- Firecrawl fallback ---

interface FirecrawlResponse {
  success?: boolean
  data?: {
    markdown?: string
    metadata?: { title?: string }
  }
  error?: string
}

/**
 * Last-resort HTML rendering via Firecrawl's `/v1/scrape` endpoint. Used
 * when the primary Readability path returns near-empty content from a 2xx
 * HTML response (JS-only shells, anti-bot walls, login redirects). Returns
 * `null` when Firecrawl is not configured or the call fails so the caller
 * falls back to the primary extraction unchanged — Firecrawl is best-effort,
 * never an error source.
 */
async function firecrawlScrape(
  url: string,
  mode: ExtractMode,
  env: NodeJS.ProcessEnv,
  fetchFn: typeof fetch,
  timeoutMs: number,
): Promise<ExtractResult | null> {
  const apiKey = env.FIRECRAWL_API_KEY
  if (!apiKey) return null
  const base = (env.FIRECRAWL_URL ?? FIRECRAWL_DEFAULT_URL).replace(/\/$/, '')
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(new Error('firecrawl timeout')), timeoutMs)
  try {
    const res = await fetchFn(`${base}/v1/scrape`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
      }),
      signal: ac.signal,
    })
    if (!res.ok) return null
    const body = (await res.json()) as FirecrawlResponse
    if (!body.success || !body.data?.markdown) return null
    const md = body.data.markdown
    const title = body.data.metadata?.title
    const text = mode === 'text' ? markdownToPlain(md) : md
    return title ? { text, title } : { text }
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

// --- per-URL cache ---

interface CacheEntry {
  value: ExtractResult
  expiresAt: number
}

function cacheGet(cache: Map<string, CacheEntry>, key: string): ExtractResult | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    cache.delete(key)
    return null
  }
  // Refresh LRU position
  cache.delete(key)
  cache.set(key, entry)
  return entry.value
}

function cacheSet(
  cache: Map<string, CacheEntry>,
  key: string,
  value: ExtractResult,
  ttlMs: number,
  maxEntries: number,
): void {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs })
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value
    if (!oldest) break
    cache.delete(oldest)
  }
}

// --- tool factory ---

export interface WebToolsOpts {
  fetchImpl?: typeof fetch
  env?: NodeJS.ProcessEnv
  /** Disable SSRF checks (tests against 127.0.0.1 mock servers). Default false. */
  allowPrivate?: boolean
  /** Cache TTL in ms. Default 15 min. */
  cacheTtlMs?: number
  /** Max cache entries. Default 100. */
  cacheMax?: number
  /** Fetch timeout in ms. Default 30s. */
  timeoutMs?: number
  /** Cap on raw response body bytes before parsing. Default 3 MB. */
  maxBodyBytes?: number
  /** Disable the Firecrawl fallback even when FIRECRAWL_API_KEY is set. */
  firecrawlDisabled?: boolean
}

/**
 * web_search backends (tried in order):
 *  1. Brave Search (env: BRAVE_API_KEY) — free tier, 2000 req/month
 *  2. SearXNG (env: SEARXNG_URL) — self-hosted, unlimited
 *  3. Error with setup instructions if neither is configured
 *
 * web_fetch: guarded fetch (SSRF-blocked private IPs) + Readability + markdown,
 * with per-URL in-memory cache (15 min TTL).
 */
export function webTools(opts?: WebToolsOpts): ToolHandler[] {
  // Default to undici 8's fetch so search-backend HTTP shares the same
  // stack as guardedFetch (and stays out of Node 24's bundled undici 7).
  const fetchFn = opts?.fetchImpl ?? (undiciFetch as unknown as typeof fetch)
  const env = opts?.env ?? process.env
  const allowPrivate = opts?.allowPrivate ?? false
  const cacheTtlMs = opts?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
  const cacheMax = opts?.cacheMax ?? DEFAULT_CACHE_MAX
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBodyBytes = opts?.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  const firecrawlDisabled = opts?.firecrawlDisabled ?? false
  const cache = new Map<string, CacheEntry>()

  return [
    {
      def: {
        name: 'web_search',
        description:
          'Search the internet. Returns a list of titles, URLs, and snippets. Requires BRAVE_API_KEY or SEARXNG_URL to be configured.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results to return (default 5)' },
          },
          required: ['query'],
        },
      },
      async invoke(args) {
        const query = String(args.query ?? '')
        if (!query) throw new Error('web_search: query is required')
        const limit = typeof args.limit === 'number' ? args.limit : 5

        const braveKey = env.BRAVE_API_KEY
        if (braveKey) {
          const results = await braveSearch(query, limit, braveKey, fetchFn)
          return results.length === 0 ? 'no results' : formatResults(results)
        }

        const searxngUrl = env.SEARXNG_URL
        if (searxngUrl) {
          const results = await searxngSearch(query, limit, searxngUrl, fetchFn)
          return results.length === 0 ? 'no results' : formatResults(results)
        }

        throw new Error(
          'web_search: no search backend configured. Set BRAVE_API_KEY (free at https://brave.com/search/api/) or SEARXNG_URL.',
        )
      },
    },
    {
      def: {
        name: 'web_fetch',
        description:
          'Fetch a URL and return its readable content. HTML is extracted via Readability and converted to markdown. When the primary extraction returns near-empty content from a 2xx HTML page (typical of JS-only shells), the tool automatically retries via Firecrawl if FIRECRAWL_API_KEY is configured. Results are cached for 15 minutes.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'The URL to fetch (http or https)' },
            max_length: {
              type: 'number',
              description: 'Max characters to return (default 20000)',
            },
            extract_mode: {
              type: 'string',
              enum: ['markdown', 'text'],
              description: 'Output format for HTML pages. Default "markdown".',
            },
          },
          required: ['url'],
        },
      },
      async invoke(args) {
        const url = String(args.url ?? '')
        if (!url) throw new Error('web_fetch: url is required')
        const maxLen = typeof args.max_length === 'number' ? args.max_length : DEFAULT_MAX_LENGTH
        const mode: ExtractMode = args.extract_mode === 'text' ? 'text' : 'markdown'
        const cacheKey = `${mode}|${url}`

        const cached = cacheGet(cache, cacheKey)
        if (cached) return formatOutput(cached, maxLen)

        let result: GuardedFetchResultShape | null = null
        try {
          result = await guardedFetch({
            url,
            fetchImpl: opts?.fetchImpl,
            allowPrivate,
            timeoutMs,
            init: {
              headers: {
                'user-agent': DEFAULT_USER_AGENT,
                accept: 'text/html,application/xhtml+xml,application/json,text/plain,*/*',
                'accept-language': 'en-US,en;q=0.9',
              },
            },
          })
          if (!result.response.ok) {
            throw new Error(`${result.response.status} ${result.response.statusText}`)
          }
          const ct = result.response.headers.get('content-type') ?? ''
          const isHtml = ct.includes('text/html') || ct.includes('xhtml')
          const { text: body, truncated } = await readBodyCapped(result.response, maxBodyBytes)
          let extracted: ExtractResult
          if (isHtml) {
            extracted = extractReadable(body, result.finalUrl, mode)
          } else if (ct.includes('application/json')) {
            try {
              extracted = { text: JSON.stringify(JSON.parse(body), null, 2) }
            } catch {
              extracted = { text: body }
            }
          } else {
            extracted = { text: body }
          }
          // Firecrawl fallback: only meaningful for HTML pages where the
          // primary extractor collapsed. Skip JSON / plain-text bodies and
          // skip when extraction already produced something substantial.
          if (
            isHtml &&
            !firecrawlDisabled &&
            extracted.text.length < FIRECRAWL_FALLBACK_THRESHOLD
          ) {
            const rescued = await firecrawlScrape(
              result.finalUrl,
              mode,
              env,
              fetchFn,
              timeoutMs,
            )
            if (rescued) {
              extracted = {
                ...rescued,
                text: `${rescued.text}\n\n[content rendered via Firecrawl fallback — primary extraction returned ${extracted.text.length} chars]`,
              }
            }
          }
          if (truncated) {
            extracted = {
              ...extracted,
              text: `${extracted.text}\n\n[raw body truncated at ${maxBodyBytes} bytes before extraction — page exceeded the size cap]`,
            }
          }
          cacheSet(cache, cacheKey, extracted, cacheTtlMs, cacheMax)
          return formatOutput(extracted, maxLen)
        } catch (err) {
          if (err instanceof SsrFBlockedError) throw new Error(`web_fetch: ${err.message}`)
          throw new Error(`web_fetch: ${describeError(err)}`)
        } finally {
          if (result) await result.release()
        }
      },
    },
  ]
}

type GuardedFetchResultShape = Awaited<ReturnType<typeof guardedFetch>>

function formatOutput(r: ExtractResult, maxLen: number): string {
  const body = r.title ? `# ${r.title}\n\n${r.text}` : r.text
  if (body.length > maxLen) return `${body.slice(0, maxLen)}\n\n[truncated at ${maxLen} chars]`
  return body
}

function formatResults(results: SearchResult[]): string {
  return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n\n')
}
