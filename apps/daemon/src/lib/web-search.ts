import type { WebSearchOutput } from '../runtime/worker/ipc-protocol.ts'

/**
 * BAZ-067: bounded public-web discovery for protected Agent turns.
 *
 * The only first backend is a self-hosted SearXNG instance speaking its
 * `format=json` API. The operator configures its base URL; it never reaches
 * the worker — the worker sees only bounded titles/URLs/snippets returned
 * through this host over turn IPC. No credential exists to leak, and the
 * configured URL is validated per request so configuration drift between
 * claim and dispatch is refused instead of silently redirected.
 *
 * Bounds: one upstream request per invocation, no worker-side retry, a hard
 * deadline, capped query/result/field sizes. Returned snippets are untrusted
 * data — provenance stays with the caller, and fetching a returned URL still
 * goes through the existing SSRF-guarded `web_fetch`.
 */

const SEARCH_TIMEOUT_MS = 15_000
const MAX_QUERY_CHARS = 512
const MAX_RESULTS = 8
const MAX_TITLE_CHARS = 200
const MAX_URL_CHARS = 2048
const MAX_SNIPPET_CHARS = 300

export const WEB_SEARCH_URL_ENV = 'BAZILION_WEB_SEARCH_URL'

/** The configured SearXNG base URL, or null when discovery is not enabled. */
export function webSearchBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env[WEB_SEARCH_URL_ENV]?.trim()
  if (!raw) return null
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  const loopback =
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === 'localhost' ||
    parsed.hostname === '::1' ||
    parsed.hostname === '[::1]'
  // The URL is operator-set daemon-side configuration; loopback http is
  // allowed for self-hosted/test instances, everything else requires https.
  if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && loopback)) return raw
  return null
}

export function isWebSearchConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return webSearchBaseUrl(env) !== null
}

export interface WebSearchHostOptions {
  /** Read at call time so configuration drift between claim and dispatch is caught. */
  env: () => NodeJS.ProcessEnv
  signal?: AbortSignal
}

class WebSearchConfigError extends Error {}
class WebSearchBackendError extends Error {}

function bounded(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

export function createWebSearchHost(opts: WebSearchHostOptions): {
  search(args: { query: string; count?: number }): Promise<WebSearchOutput>
} {
  return {
    async search(args) {
      const query =
        typeof args?.query === 'string' ? args.query.trim().slice(0, MAX_QUERY_CHARS) : ''
      if (!query) throw new WebSearchConfigError('web search: a non-empty query is required')
      const count = Math.min(Math.max(Number(args?.count ?? 5), 1), MAX_RESULTS)

      const baseUrl = webSearchBaseUrl(opts.env())
      if (!baseUrl) {
        throw new WebSearchConfigError(
          `No web search backend is configured. Set ${WEB_SEARCH_URL_ENV} (a self-hosted SearXNG base URL, https or loopback) or disable discovery for this turn.`,
        )
      }

      const url = `${baseUrl.replace(/\/+$/, '')}/search?${new URLSearchParams({
        q: query,
        format: 'json',
      })}`
      let response: Response
      try {
        response = await fetch(url, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.any([
            AbortSignal.timeout(SEARCH_TIMEOUT_MS),
            ...(opts.signal ? [opts.signal] : []),
          ]),
        })
      } catch (error) {
        if (opts.signal?.aborted || (error instanceof Error && error.name === 'AbortError'))
          throw new WebSearchBackendError('Web search was cancelled')
        throw new WebSearchBackendError('Web search backend is unreachable')
      }
      if (!response.ok) {
        throw new WebSearchBackendError(`Web search backend returned status ${response.status}`)
      }

      let data: unknown
      try {
        data = await response.json()
      } catch {
        throw new WebSearchBackendError('Web search backend returned an invalid response')
      }
      const rawResults =
        data && typeof data === 'object' ? (data as { results?: unknown }).results : undefined
      if (!Array.isArray(rawResults)) {
        throw new WebSearchBackendError('Web search backend returned an invalid response')
      }
      const results = rawResults.slice(0, count).map((item) => {
        const row = item as { title?: unknown; url?: unknown; content?: unknown }
        return {
          title: bounded(row.title, MAX_TITLE_CHARS),
          url: bounded(row.url, MAX_URL_CHARS),
          snippet: bounded(row.content, MAX_SNIPPET_CHARS),
        }
      })
      return { results, backend: 'searxng' }
    },
  }
}
