import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test, vi } from 'vitest'
import { responsesStream } from '../../src/lib/openai-responses.ts'
import { createWebSearchHost, searchRoute, searchStatus } from '../../src/lib/web-search.ts'
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
  expect(searchStatus(brave)).toBe('Web search uses brave.')
  expect(searchStatus({})).toContain('OpenAI or ChatGPT')
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
