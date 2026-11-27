import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test, vi } from 'vitest'
import { responsesStream } from '../../src/lib/openai-responses.ts'
import { createWebSearchHost, searchRoute } from '../../src/lib/web-search.ts'
import { webSearchTool } from '../../src/runtime/tools/web.ts'
import type { WebSearchOutput } from '../../src/runtime/worker/ipc-protocol.ts'

const brave = { BRAVE_API_KEY: 'brave-key' }
const searx = { SEARXNG_URL: 'http://127.0.0.1:8888/' }

test('auto picks Brave, then SearXNG, then the hosted search of an OpenAI or ChatGPT model', () => {
  expect(searchRoute({ ...brave, ...searx }, 'lmstudio:m', false)).toEqual({ backend: 'brave' })
  expect(searchRoute(searx, 'openai:gpt-5', false)).toEqual({ backend: 'searxng' })
  expect(searchRoute({ OPENAI_API_KEY: 'sk' }, 'openai:gpt-5', false)).toEqual({
    backend: 'openai',
  })
  expect(searchRoute({}, 'openai-codex:gpt-6-astra', true)).toEqual({ backend: 'openai-codex' })
  expect(searchRoute({}, 'lmstudio:m', true).backend).toBeNull()
  expect(searchRoute({ ...brave, BAZILION_WEB_SEARCH_ROUTE: 'off' }, 'lmstudio:m', false)).toEqual({
    backend: null,
    reason: 'Web search is off.',
  })
  expect(searchRoute({ BAZILION_WEB_SEARCH_ROUTE: 'searxng' }, 'm:m', false).backend).toBeNull()
  expect(
    searchRoute(
      { ...brave, OPENAI_API_KEY: 'sk', BAZILION_WEB_SEARCH_ROUTE: 'native' },
      'openai:x',
      false,
    ),
  ).toEqual({ backend: 'openai' })
})

test('Brave and SearXNG results come back as readable links', async () => {
  const fetcher = vi.fn<typeof fetch>(async (url) =>
    String(url).startsWith('https://api.search.brave.com')
      ? Response.json({
          web: { results: [{ title: 'NASA', url: 'https://nasa.gov', description: 'Space' }] },
        })
      : Response.json({
          results: [{ title: 'Docs', url: 'https://example.com', content: 'Text' }],
        }),
  )
  const host = (backend: 'brave' | 'searxng') =>
    createWebSearchHost({
      backend,
      env: () => ({ ...brave, ...searx }),
      model: 'lmstudio:m',
      codexToken: async () => '',
      signal: new AbortController().signal,
      fetch: fetcher,
    })
  expect(await host('brave').search({ query: 'artemis', count: 3 })).toEqual({
    backend: 'brave',
    results: [{ title: 'NASA', url: 'https://nasa.gov', snippet: 'Space' }],
  })
  const [braveUrl, braveInit] = fetcher.mock.calls[0] ?? []
  expect(String(braveUrl)).toBe('https://api.search.brave.com/res/v1/web/search?q=artemis&count=3')
  expect(new Headers(braveInit?.headers).get('x-subscription-token')).toBe('brave-key')
  const searxng = await host('searxng').search({ query: 'docs' })
  expect(String(fetcher.mock.calls[1]?.[0])).toBe('http://127.0.0.1:8888/search?q=docs&format=json')
  const text = await webSearchTool({ search: async () => searxng }).invoke({ query: 'docs' })
  expect(text).toBe('Results (searxng):\n1. Docs\n   https://example.com\n   Text')
  await expect(host('brave').search({ query: '' })).rejects.toThrow('1–512')
})

test('hosted search returns the model’s answer and its cited sources', async () => {
  const answer = {
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'output_text',
        text: 'Artemis II flies four astronauts around the Moon.',
        annotations: [
          { type: 'url_citation', title: 'NASA', url: 'https://www.nasa.gov/artemis-ii/' },
          { type: 'url_citation', title: 'NASA', url: 'https://www.nasa.gov/artemis-ii/' },
        ],
      },
    ],
  }
  const stream = (completedOutput: unknown[]) =>
    new Response(
      [
        { type: 'response.output_item.done', output_index: 0, item: answer },
        { type: 'response.completed', response: { output: completedOutput } },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(''),
    )
  const fetcher = vi.fn<typeof fetch>(async () => stream([answer]))
  const host = (backend: 'openai' | 'openai-codex') =>
    createWebSearchHost({
      backend,
      env: () => ({ OPENAI_API_KEY: 'sk-search' }),
      model: `${backend}:gpt-6-astra`,
      codexToken: async () => 'codex-token',
      signal: new AbortController().signal,
      fetch: fetcher,
    })
  const output = await host('openai').search({ query: 'Artemis II' })
  expect(output).toEqual({
    backend: 'openai',
    answer: 'Artemis II flies four astronauts around the Moon.',
    results: [{ title: 'NASA', url: 'https://www.nasa.gov/artemis-ii/', snippet: '' }],
  } satisfies WebSearchOutput)
  const [url, init] = fetcher.mock.calls[0] ?? []
  expect(url).toBe('https://api.openai.com/v1/responses')
  expect(new Headers(init?.headers).get('authorization')).toBe('Bearer sk-search')
  expect(JSON.parse(String(init?.body))).toMatchObject({
    model: 'gpt-6-astra',
    tools: [{ type: 'web_search' }],
  })
  // The ChatGPT backend may end with an empty output; the streamed items are the answer then.
  fetcher.mockResolvedValueOnce(stream([]))
  expect((await host('openai-codex').search({ query: 'Artemis II' })).answer).toContain('Artemis')
  expect(String(fetcher.mock.calls[1]?.[0])).toBe('https://chatgpt.com/backend-api/codex/responses')
  // Searches run side by side.
  const both = await Promise.all([
    host('openai').search({ query: 'a' }),
    host('openai').search({ query: 'b' }),
  ])
  expect(both).toHaveLength(2)
  const text = await webSearchTool({ search: async () => output }).invoke({ query: 'x' })
  expect(text).toContain('Answer (openai search):')
  expect(text).toContain('Sources:\n1. NASA\n   https://www.nasa.gov/artemis-ii/')
})

test('a backend error carries the provider’s own status and message', async () => {
  const host = createWebSearchHost({
    backend: 'openai',
    env: () => ({ OPENAI_API_KEY: 'sk' }),
    model: 'openai:gpt-6-astra',
    codexToken: async () => '',
    signal: new AbortController().signal,
    fetch: async () =>
      new Response('{"error":{"message":"Hosted search is not enabled for this model"}}', {
        status: 400,
      }),
  })
  await expect(host.search({ query: 'x' })).rejects.toThrow(
    /web_search \(openai\): HTTP 400: .*not enabled for this model/,
  )
})

async function localServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ url: string; hits: () => number; close: () => Promise<void> }> {
  let hits = 0
  const server = createServer((request, response) => {
    hits++
    handler(request, response)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    hits: () => hits,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

test('credentialed backend requests never follow a redirect, and oversized bodies are refused', async () => {
  const destination = await localServer((_request, response) => response.end('{}'))
  const redirecting = await localServer((_request, response) => {
    response.writeHead(302, { location: `${destination.url}/search` }).end()
  })
  const oversized = await localServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(`{"results":"${'x'.repeat(2 * 1024 * 1024)}"}`)
  })
  const searxng = (url: string) =>
    createWebSearchHost({
      backend: 'searxng',
      env: () => ({ SEARXNG_URL: url }),
      model: 'lmstudio:m',
      codexToken: async () => '',
      signal: new AbortController().signal,
    })
  try {
    await expect(searxng(redirecting.url).search({ query: 'x' })).rejects.toThrow('web_search')
    await expect(
      responsesStream(
        redirecting.url,
        { authorization: 'Bearer sk-secret' },
        {},
        new AbortController().signal,
      ),
    ).rejects.toThrow()
    expect(redirecting.hits()).toBe(2)
    expect(destination.hits()).toBe(0)
    await expect(searxng(oversized.url).search({ query: 'x' })).rejects.toThrow(
      'larger than 2097152 bytes',
    )
  } finally {
    await Promise.all([destination.close(), redirecting.close(), oversized.close()])
  }
})

function hostWith(
  backend: WebSearchOutput['backend'],
  fetcher: typeof fetch,
  env: NodeJS.ProcessEnv = {},
) {
  return createWebSearchHost({
    backend,
    env: () => ({ TAVILY_API_KEY: 'tvly-key', EXA_API_KEY: 'exa-key', ...brave, ...searx, ...env }),
    model: 'openai:gpt-5',
    codexToken: async () => '',
    signal: new AbortController().signal,
    fetch: fetcher,
  })
}

test('auto takes Tavily, then Exa, after Brave and SearXNG', () => {
  expect(searchRoute({ TAVILY_API_KEY: 't', EXA_API_KEY: 'e' }, 'lmstudio:m', false)).toEqual({
    backend: 'tavily',
  })
  expect(searchRoute({ EXA_API_KEY: 'e' }, 'lmstudio:m', false)).toEqual({ backend: 'exa' })
  expect(searchRoute({ BAZILION_WEB_SEARCH_ROUTE: 'exa' }, 'lmstudio:m', false)).toEqual({
    backend: null,
    reason: 'Exa search needs EXA_API_KEY.',
  })
})

test('Brave and SearXNG take the filters they support, and say which they could not', async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ web: { results: [] }, results: [] }),
  )
  const filters = {
    query: 'rust release',
    after: '2026-01-01',
    before: '2026-02-01',
    sites: ['blog.rust-lang.org'],
    excludeSites: ['reddit.com'],
    country: 'it',
    language: 'IT',
  }
  expect((await hostWith('brave', fetcher).search(filters)).unapplied).toBeUndefined()
  const braveUrl = new URL(String(fetcher.mock.calls[0]?.[0]))
  expect(Object.fromEntries(braveUrl.searchParams)).toEqual({
    q: 'rust release site:blog.rust-lang.org -site:reddit.com',
    count: '5',
    freshness: '2026-01-01to2026-02-01',
    country: 'IT',
    search_lang: 'it',
  })
  const searx = await hostWith('searxng', fetcher).search({ ...filters, freshness: 'week' })
  // Dates win over a freshness given with them; SearXNG takes neither dates nor a country.
  expect(searx.unapplied).toEqual(['after', 'before', 'country', 'freshness'])
  const searxUrl = new URL(String(fetcher.mock.calls[1]?.[0]))
  expect(searxUrl.searchParams.get('time_range')).toBeNull()
  expect(searxUrl.searchParams.get('language')).toBe('it')
})

test('Tavily and Exa get their own request shapes, with their keys', async () => {
  const fetcher = vi.fn<typeof fetch>(async (url) =>
    String(url).includes('tavily')
      ? Response.json({
          results: [
            { title: 'T', url: 'https://t.example', content: 'tav', published_date: 'Tue' },
          ],
        })
      : Response.json({
          results: [{ title: 'E', url: 'https://e.example', highlights: ['one', 'two'] }],
        }),
  )
  const tavily = await hostWith('tavily', fetcher).search({
    query: 'q',
    count: 3,
    freshness: 'month',
    sites: ['https://example.com/'],
    country: 'GB',
    language: 'en',
  })
  expect(tavily).toEqual({
    backend: 'tavily',
    results: [{ title: 'T', url: 'https://t.example', snippet: 'tav', published: 'Tue' }],
  })
  const [tavilyUrl, tavilyInit] = fetcher.mock.calls[0] ?? []
  expect(String(tavilyUrl)).toBe('https://api.tavily.com/search')
  expect(new Headers(tavilyInit?.headers).get('authorization')).toBe('Bearer tvly-key')
  expect(JSON.parse(String(tavilyInit?.body))).toEqual({
    query: 'q',
    max_results: 3,
    time_range: 'month',
    include_domains: ['example.com'],
    country: 'united kingdom',
    language: 'en',
    filter_by_language: true,
    include_published_date: true,
  })

  const exa = await hostWith('exa', fetcher).search({
    query: 'q',
    before: '2025-12-31',
    excludeSites: ['spam.example'],
    language: 'en',
  })
  expect(exa).toEqual({
    backend: 'exa',
    results: [{ title: 'E', url: 'https://e.example', snippet: 'one … two' }],
    unapplied: ['language'],
  })
  const [, exaInit] = fetcher.mock.calls[1] ?? []
  expect(new Headers(exaInit?.headers).get('x-api-key')).toBe('exa-key')
  expect(JSON.parse(String(exaInit?.body))).toEqual({
    query: 'q',
    numResults: 5,
    endPublishedDate: '2025-12-31T23:59:59.999Z',
    excludeDomains: ['spam.example'],
    contents: { highlights: true },
  })
})

test('a filter that is not valid is refused; a search repeated in a turn is asked once', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ web: { results: [] } }))
  const host = hostWith('brave', fetcher)
  await expect(host.search({ query: 'q', after: 'last week' })).rejects.toThrow(/YYYY-MM-DD/)
  await expect(host.search({ query: 'q', country: 'Italy' })).rejects.toThrow(/two-letter/)
  await expect(host.search({ query: 'q', sites: ['not a site'] })).rejects.toThrow(/not a site/)
  await host.search({ query: 'same', freshness: 'day' })
  await host.search({ query: 'same', freshness: 'day' })
  await host.search({ query: 'same', freshness: 'week' })
  expect(fetcher).toHaveBeenCalledTimes(2)
})

test('the tool names what the backend could not apply', async () => {
  const tool = webSearchTool({
    search: async () => ({
      backend: 'searxng',
      results: [{ title: 'A', url: 'https://a.example', snippet: 's', published: '2026-01-02' }],
      unapplied: ['country'],
    }),
  })
  const text = String(await tool.invoke({ query: 'q', country: 'IT' }, { toolCallId: 'c' }))
  expect(text).toContain('Published: 2026-01-02')
  expect(text).toContain('Not applied by searxng search: country.')
})
