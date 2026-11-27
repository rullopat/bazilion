import { parseModelString } from '../core/providers.ts'
import type {
  WebSearchArgs,
  WebSearchHost,
  WebSearchOutput,
} from '../runtime/worker/ipc-protocol.ts'
import {
  assertOk,
  CODEX_RESPONSES_URL,
  codexHeaders,
  OPENAI_RESPONSES_URL,
  readCapped,
  responsesStream,
} from './openai-responses.ts'

// web_search runs in the daemon for every turn. BAZILION_WEB_SEARCH_ROUTE picks the backend:
// Brave, a SearXNG instance, Tavily, Exa, or the search hosted by the Agent's own OpenAI or
// ChatGPT model. Each backend applies the filters it supports and says which it could not; a
// search repeated within one turn is answered from the first one.

export type SearchBackend = WebSearchOutput['backend']
const DEADLINE_MS = 30_000

/**
 * The backend a turn of `model` searches with, or why it has none. `auto` takes Brave, then
 * SearXNG, Tavily, Exa, then the hosted search of an OpenAI or ChatGPT model.
 */
export function searchRoute(
  env: NodeJS.ProcessEnv,
  model: string,
  codexConnected: boolean,
): { backend: SearchBackend } | { backend: null; reason: string } {
  const route = env.BAZILION_WEB_SEARCH_ROUTE || 'auto'
  const provider = model.slice(0, model.indexOf(':'))
  const native = (): { backend: SearchBackend } | { backend: null; reason: string } =>
    provider === 'openai' && env.OPENAI_API_KEY?.trim()
      ? { backend: 'openai' }
      : provider === 'openai-codex' && codexConnected
        ? { backend: 'openai-codex' }
        : {
            backend: null,
            reason: 'Hosted search needs an Agent on an OpenAI (API key) or ChatGPT model.',
          }
  switch (route) {
    case 'off':
      return { backend: null, reason: 'Web search is off.' }
    case 'brave':
      return env.BRAVE_API_KEY?.trim()
        ? { backend: 'brave' }
        : { backend: null, reason: 'Brave search needs BRAVE_API_KEY.' }
    case 'searxng':
      return env.SEARXNG_URL?.trim()
        ? { backend: 'searxng' }
        : { backend: null, reason: 'SearXNG search needs SEARXNG_URL.' }
    case 'tavily':
      return env.TAVILY_API_KEY?.trim()
        ? { backend: 'tavily' }
        : { backend: null, reason: 'Tavily search needs TAVILY_API_KEY.' }
    case 'exa':
      return env.EXA_API_KEY?.trim()
        ? { backend: 'exa' }
        : { backend: null, reason: 'Exa search needs EXA_API_KEY.' }
    case 'native':
      return native()
    case 'auto':
      if (env.BRAVE_API_KEY?.trim()) return { backend: 'brave' }
      if (env.SEARXNG_URL?.trim()) return { backend: 'searxng' }
      if (env.TAVILY_API_KEY?.trim()) return { backend: 'tavily' }
      if (env.EXA_API_KEY?.trim()) return { backend: 'exa' }
      return native().backend
        ? native()
        : {
            backend: null,
            reason:
              'No search backend: save a Brave, Tavily or Exa key or a SearXNG address, or use an OpenAI or ChatGPT model.',
          }
    default:
      return { backend: null, reason: `Unknown search route "${route}".` }
  }
}

export interface WebSearchHostOptions {
  backend: SearchBackend
  env: () => NodeJS.ProcessEnv
  /** The Agent's model, `provider:id`; hosted search runs on it. */
  model: string
  codexToken: () => Promise<string>
  signal: AbortSignal
  /** Tests replace the network. */
  fetch?: typeof fetch
}

function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.slice(0, limit) : ''
}

async function getJson(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json', ...headers },
    signal,
    redirect: 'error',
  })
  await assertOk(response)
  return JSON.parse(await readCapped(response, 2 * 1024 * 1024)) as Record<string, unknown>
}

/** What was asked for, checked: a filter that is not valid is refused, not dropped. */
interface Filters {
  freshness?: 'day' | 'week' | 'month' | 'year'
  after?: string
  before?: string
  sites: string[]
  excludeSites: string[]
  country?: string
  language?: string
}

const FRESHNESS = ['day', 'week', 'month', 'year'] as const
const DAYS: Record<(typeof FRESHNESS)[number], number> = { day: 1, week: 7, month: 31, year: 366 }

function checkDate(name: string, value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(value))
  )
    throw new Error(`web_search: ${name} must be a date as YYYY-MM-DD`)
  return value
}

function checkSites(name: string, value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`web_search: ${name} must be a list of sites`)
  return value.map((site) => {
    const host = String(site)
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/, '')
      .toLowerCase()
    if (!/^[a-z0-9*][a-z0-9.*-]*(\/\S*)?$/.test(host))
      throw new Error(`web_search: "${site}" in ${name} is not a site such as example.com`)
    return host
  })
}

function readFilters(args: WebSearchArgs): Filters {
  const freshness = args.freshness
  if (freshness !== undefined && !FRESHNESS.includes(freshness))
    throw new Error('web_search: freshness must be day, week, month or year')
  const country = args.country?.trim()
  if (country && !/^[a-z]{2}$/i.test(country))
    throw new Error('web_search: country must be a two-letter code such as IT')
  const language = args.language?.trim()
  if (language && !/^[a-z]{2}$/i.test(language))
    throw new Error('web_search: language must be a two-letter code such as it')
  const after = checkDate('after', args.after)
  const before = checkDate('before', args.before)
  return {
    // Dates win over a freshness given with them.
    ...(freshness && !after && !before ? { freshness } : {}),
    ...(after ? { after } : {}),
    ...(before ? { before } : {}),
    sites: checkSites('sites', args.sites),
    excludeSites: checkSites('exclude_sites', args.excludeSites),
    ...(country ? { country: country.toUpperCase() } : {}),
    ...(language ? { language: language.toLowerCase() } : {}),
  }
}

/** The names of the filters in effect, as the tool calls them. */
function asked(filters: Filters): string[] {
  return [
    ...(filters.freshness ? ['freshness'] : []),
    ...(filters.after ? ['after'] : []),
    ...(filters.before ? ['before'] : []),
    ...(filters.sites.length ? ['sites'] : []),
    ...(filters.excludeSites.length ? ['exclude_sites'] : []),
    ...(filters.country ? ['country'] : []),
    ...(filters.language ? ['language'] : []),
  ]
}

/** `site:` operators, for backends that read them from the query. */
function withSites(query: string, filters: Filters): string {
  const only = filters.sites.map((site) => `site:${site}`).join(' OR ')
  const not = filters.excludeSites.map((site) => `-site:${site}`).join(' ')
  return [query, only && (filters.sites.length > 1 ? `(${only})` : only), not]
    .filter(Boolean)
    .join(' ')
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** The earliest publication date a freshness means, as YYYY-MM-DD. */
function since(freshness: Filters['freshness']): string | undefined {
  return freshness ? isoDay(Date.now() - DAYS[freshness] * 86_400_000) : undefined
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal,
    redirect: 'error',
  })
  await assertOk(response)
  return JSON.parse(await readCapped(response, 2 * 1024 * 1024)) as Record<string, unknown>
}

type Found = Omit<WebSearchOutput, 'backend' | 'unapplied'> & {
  /** Filters this backend applied; the others asked for are reported. */
  applied: string[]
}

export function createWebSearchHost(opts: WebSearchHostOptions): WebSearchHost {
  const fetchImpl = opts.fetch ?? fetch
  // One turn's searches: the same one again is answered from the first.
  const earlier = new Map<string, Promise<WebSearchOutput>>()
  return {
    search(args: WebSearchArgs): Promise<WebSearchOutput> {
      const query = typeof args?.query === 'string' ? args.query.trim() : ''
      if (!query || query.length > 512)
        return Promise.reject(new Error('web_search needs a query of 1–512 characters'))
      const count =
        Number.isInteger(args.count) && (args.count as number) >= 1
          ? Math.min(args.count as number, 10)
          : 5
      let filters: Filters
      try {
        filters = readFilters(args)
      } catch (error) {
        return Promise.reject(error)
      }
      const key = JSON.stringify([query, count, filters])
      const known = earlier.get(key)
      if (known) return known
      const run = searchOnce(opts, fetchImpl, query, count, filters).then(
        ({ applied, ...found }): WebSearchOutput => {
          // A freshness given with dates gives way to them.
          const dropped = args.freshness && (filters.after || filters.before) ? ['freshness'] : []
          const unapplied = [
            ...asked(filters).filter((name) => !applied.includes(name)),
            ...dropped,
          ]
          return {
            backend: opts.backend,
            ...found,
            ...(unapplied.length ? { unapplied: [...new Set(unapplied)] } : {}),
          }
        },
      )
      earlier.set(key, run)
      // A failed search may be tried again.
      run.catch(() => earlier.delete(key))
      return run
    },
  }
}

async function searchOnce(
  opts: WebSearchHostOptions,
  fetchImpl: typeof fetch,
  query: string,
  count: number,
  filters: Filters,
): Promise<Found> {
  const signal = AbortSignal.any([opts.signal, AbortSignal.timeout(DEADLINE_MS)])
  const env = opts.env()
  const sites =
    filters.sites.length || filters.excludeSites.length ? ['sites', 'exclude_sites'] : []
  try {
    if (opts.backend === 'brave') {
      const range =
        filters.after || filters.before
          ? `${filters.after ?? '1970-01-01'}to${filters.before ?? isoDay(Date.now())}`
          : filters.freshness
            ? { day: 'pd', week: 'pw', month: 'pm', year: 'py' }[filters.freshness]
            : undefined
      const params = new URLSearchParams({ q: withSites(query, filters), count: String(count) })
      if (range) params.set('freshness', range)
      if (filters.country) params.set('country', filters.country)
      if (filters.language) params.set('search_lang', filters.language)
      const body = await getJson(
        `https://api.search.brave.com/res/v1/web/search?${params}`,
        { 'x-subscription-token': env.BRAVE_API_KEY ?? '' },
        signal,
        fetchImpl,
      )
      const rows = (body.web as { results?: unknown } | undefined)?.results
      return {
        applied: ['freshness', 'after', 'before', ...sites, 'country', 'language'],
        results: (Array.isArray(rows) ? rows : []).slice(0, count).map((row) => ({
          title: text(row?.title, 200),
          url: text(row?.url, 2048),
          snippet: text(row?.description, 300),
          ...(row?.page_age ? { published: text(row.page_age, 40) } : {}),
        })),
      }
    }
    if (opts.backend === 'searxng') {
      const base = (env.SEARXNG_URL ?? '').replace(/\/+$/, '')
      const params = new URLSearchParams({ q: withSites(query, filters), format: 'json' })
      if (filters.freshness) params.set('time_range', filters.freshness)
      if (filters.language) params.set('language', filters.language)
      const body = await getJson(`${base}/search?${params}`, {}, signal, fetchImpl)
      return {
        // SearXNG passes the time range and site: to the engines that take them.
        applied: ['freshness', ...sites, 'language'],
        results: (Array.isArray(body.results) ? body.results : []).slice(0, count).map((row) => ({
          title: text(row?.title, 200),
          url: text(row?.url, 2048),
          snippet: text(row?.content, 300),
          ...(row?.publishedDate ? { published: text(row.publishedDate, 40) } : {}),
        })),
      }
    }
    if (opts.backend === 'tavily') {
      const country = filters.country
        ? new Intl.DisplayNames(['en'], { type: 'region' }).of(filters.country)?.toLowerCase()
        : undefined
      const body = await postJson(
        'https://api.tavily.com/search',
        { authorization: `Bearer ${env.TAVILY_API_KEY ?? ''}` },
        {
          query,
          max_results: count,
          ...(filters.freshness ? { time_range: filters.freshness } : {}),
          ...(filters.after ? { start_date: filters.after } : {}),
          ...(filters.before ? { end_date: filters.before } : {}),
          ...(filters.sites.length ? { include_domains: filters.sites } : {}),
          ...(filters.excludeSites.length ? { exclude_domains: filters.excludeSites } : {}),
          ...(country ? { country } : {}),
          ...(filters.language ? { language: filters.language, filter_by_language: true } : {}),
          include_published_date: true,
        },
        signal,
        fetchImpl,
      )
      return {
        applied: ['freshness', 'after', 'before', ...sites, 'country', 'language'],
        results: (Array.isArray(body.results) ? body.results : []).slice(0, count).map((row) => ({
          title: text(row?.title, 200),
          url: text(row?.url, 2048),
          snippet: text(row?.content, 300),
          ...(row?.published_date ? { published: text(row.published_date, 40) } : {}),
        })),
      }
    }
    if (opts.backend === 'exa') {
      const start = filters.after ?? since(filters.freshness)
      const body = await postJson(
        'https://api.exa.ai/search',
        { 'x-api-key': env.EXA_API_KEY ?? '' },
        {
          query,
          numResults: count,
          ...(start ? { startPublishedDate: `${start}T00:00:00.000Z` } : {}),
          ...(filters.before ? { endPublishedDate: `${filters.before}T23:59:59.999Z` } : {}),
          ...(filters.sites.length ? { includeDomains: filters.sites } : {}),
          ...(filters.excludeSites.length ? { excludeDomains: filters.excludeSites } : {}),
          ...(filters.country ? { userLocation: filters.country } : {}),
          contents: { highlights: true },
        },
        signal,
        fetchImpl,
      )
      return {
        applied: ['freshness', 'after', 'before', ...sites, 'country'],
        results: (Array.isArray(body.results) ? body.results : []).slice(0, count).map((row) => ({
          title: text(row?.title, 200),
          url: text(row?.url, 2048),
          snippet: text(
            Array.isArray(row?.highlights) ? row.highlights.join(' … ') : row?.text,
            300,
          ),
          ...(row?.publishedDate ? { published: text(row.publishedDate, 40) } : {}),
        })),
      }
    }
    return await hostedSearch(opts, query, count, filters, signal, fetchImpl, env)
  } catch (error) {
    if (opts.signal.aborted) throw new Error('web_search: cancelled')
    if (signal.aborted) throw new Error('web_search: no answer within 30 seconds')
    throw new Error(`web_search (${opts.backend}): ${(error as Error).message}`)
  }
}

/** Search hosted by the Agent's own OpenAI or ChatGPT model: a written answer with its citations. */
async function hostedSearch(
  opts: WebSearchHostOptions,
  query: string,
  count: number,
  filters: Filters,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
  env: NodeJS.ProcessEnv,
): Promise<Found> {
  const codex = opts.backend === 'openai-codex'
  const output = await responsesStream(
    codex ? CODEX_RESPONSES_URL : OPENAI_RESPONSES_URL,
    codex
      ? codexHeaders(await opts.codexToken())
      : { authorization: `Bearer ${env.OPENAI_API_KEY ?? ''}` },
    {
      model: parseModelString(opts.model).modelId,
      instructions: `Search the web for the query and answer concisely, citing up to ${count} sources.`,
      input: [{ role: 'user', content: [{ type: 'input_text', text: query }] }],
      tools: [
        {
          type: 'web_search',
          ...(filters.sites.length ? { filters: { allowed_domains: filters.sites } } : {}),
          ...(filters.country
            ? { user_location: { type: 'approximate', country: filters.country } }
            : {}),
        },
      ],
      tool_choice: { type: 'web_search' },
    },
    signal,
    fetchImpl,
  )
  const answer: string[] = []
  const results: WebSearchOutput['results'] = []
  for (const item of output) {
    if (item.type !== 'message' || !Array.isArray(item.content)) continue
    for (const part of item.content as Array<Record<string, unknown>>) {
      if (part.type !== 'output_text' || typeof part.text !== 'string') continue
      answer.push(part.text)
      for (const note of Array.isArray(part.annotations) ? part.annotations : []) {
        const url = text(note?.url, 2048)
        if (note?.type === 'url_citation' && url && !results.some((r) => r.url === url))
          results.push({ title: text(note.title, 200), url, snippet: '' })
      }
    }
  }
  if (!answer.join('').trim()) throw new Error('the model returned no answer')
  return {
    // The model's own search keeps to sites and a country; it takes no date or exclusion.
    applied: ['sites', 'country'],
    answer: answer.join('\n').trim(),
    results: results.slice(0, count),
  }
}
