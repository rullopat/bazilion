import type { ToolHandler } from './types.ts'
import { type ExtractMode, type ExtractResult, extractReadable } from './web-extract.ts'
import { guardedFetch, SsrFBlockedError } from './web-ssrf.ts'

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
const DEFAULT_CACHE_TTL_MS = 15 * 60_000
const DEFAULT_CACHE_MAX = 100
const DEFAULT_MAX_LENGTH = 20_000
const DEFAULT_TIMEOUT_MS = 20_000

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
  /** Fetch timeout in ms. Default 20s. */
  timeoutMs?: number
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
  const fetchFn = opts?.fetchImpl ?? fetch
  const env = opts?.env ?? process.env
  const allowPrivate = opts?.allowPrivate ?? false
  const cacheTtlMs = opts?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
  const cacheMax = opts?.cacheMax ?? DEFAULT_CACHE_MAX
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
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
          'Fetch a URL and return its readable content. HTML is extracted via Readability and converted to markdown. Results are cached for 15 minutes.',
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

        let result: GuardedFetchResultShape
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
        } catch (err) {
          if (err instanceof SsrFBlockedError) throw new Error(`web_fetch: ${err.message}`)
          throw err
        }

        try {
          if (!result.response.ok) {
            throw new Error(`web_fetch: ${result.response.status} ${result.response.statusText}`)
          }
          const ct = result.response.headers.get('content-type') ?? ''
          const body = await result.response.text()
          let extracted: ExtractResult
          if (ct.includes('text/html') || ct.includes('xhtml')) {
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
          cacheSet(cache, cacheKey, extracted, cacheTtlMs, cacheMax)
          return formatOutput(extracted, maxLen)
        } finally {
          await result.release()
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
