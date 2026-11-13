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
// Brave, a SearXNG instance, or the search hosted by the Agent's own OpenAI or ChatGPT model.

export type SearchBackend = WebSearchOutput['backend']
const DEADLINE_MS = 30_000

/**
 * The backend a turn of `model` searches with, or why it has none. `auto` takes Brave, then
 * SearXNG, then the hosted search of an OpenAI or ChatGPT model.
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
    case 'native':
      return native()
    case 'auto':
      if (env.BRAVE_API_KEY?.trim()) return { backend: 'brave' }
      if (env.SEARXNG_URL?.trim()) return { backend: 'searxng' }
      return native().backend
        ? native()
        : {
            backend: null,
            reason:
              'No search backend: set BRAVE_API_KEY or SEARXNG_URL, or use an OpenAI or ChatGPT model.',
          }
    default:
      return { backend: null, reason: `Unknown search route "${route}".` }
  }
}

/** The Config page's one-line summary, independent of any Agent's model. */
export function searchStatus(env: NodeJS.ProcessEnv): string {
  const route = env.BAZILION_WEB_SEARCH_ROUTE || 'auto'
  if (route === 'off') return 'Web search is off.'
  if (route === 'native' || (route === 'auto' && !env.BRAVE_API_KEY && !env.SEARXNG_URL))
    return 'Hosted search for Agents on OpenAI or ChatGPT models; other Agents have no web_search.'
  const backend = searchRoute(env, '', false)
  return backend.backend ? `Web search uses ${backend.backend}.` : backend.reason
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

export function createWebSearchHost(opts: WebSearchHostOptions): WebSearchHost {
  const fetchImpl = opts.fetch ?? fetch
  return {
    async search(args: WebSearchArgs): Promise<WebSearchOutput> {
      const query = typeof args?.query === 'string' ? args.query.trim() : ''
      if (!query || query.length > 512)
        throw new Error('web_search needs a query of 1–512 characters')
      const count =
        Number.isInteger(args.count) && (args.count as number) >= 1
          ? Math.min(args.count as number, 10)
          : 5
      const signal = AbortSignal.any([opts.signal, AbortSignal.timeout(DEADLINE_MS)])
      const env = opts.env()
      try {
        if (opts.backend === 'brave') {
          const body = await getJson(
            `https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q: query, count: String(count) })}`,
            { 'x-subscription-token': env.BRAVE_API_KEY ?? '' },
            signal,
            fetchImpl,
          )
          const rows = (body.web as { results?: unknown } | undefined)?.results
          return {
            backend: 'brave',
            results: (Array.isArray(rows) ? rows : []).slice(0, count).map((row) => ({
              title: text(row?.title, 200),
              url: text(row?.url, 2048),
              snippet: text(row?.description, 300),
            })),
          }
        }
        if (opts.backend === 'searxng') {
          const base = (env.SEARXNG_URL ?? '').replace(/\/+$/, '')
          const body = await getJson(
            `${base}/search?${new URLSearchParams({ q: query, format: 'json' })}`,
            {},
            signal,
            fetchImpl,
          )
          return {
            backend: 'searxng',
            results: (Array.isArray(body.results) ? body.results : [])
              .slice(0, count)
              .map((row) => ({
                title: text(row?.title, 200),
                url: text(row?.url, 2048),
                snippet: text(row?.content, 300),
              })),
          }
        }
        return await hostedSearch(opts, query, count, signal, fetchImpl, env)
      } catch (error) {
        if (opts.signal.aborted) throw new Error('web_search: cancelled')
        if (signal.aborted) throw new Error('web_search: no answer within 30 seconds')
        throw new Error(`web_search (${opts.backend}): ${(error as Error).message}`)
      }
    },
  }
}

/** Search hosted by the Agent's own OpenAI or ChatGPT model: a written answer with its citations. */
async function hostedSearch(
  opts: WebSearchHostOptions,
  query: string,
  count: number,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
  env: NodeJS.ProcessEnv,
): Promise<WebSearchOutput> {
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
      tools: [{ type: 'web_search' }],
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
    backend: opts.backend,
    answer: answer.join('\n').trim(),
    results: results.slice(0, count),
  }
}
