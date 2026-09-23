import { createServer, type ServerResponse } from 'node:http'
import { describe, expect, test, vi } from 'vitest'
import {
  createWebSearchHost,
  isWebSearchConfigured,
  WEB_SEARCH_URL_ENV,
} from '../../src/lib/web-search.ts'

interface SearxngFixture {
  url: string
  queries: string[]
  respond: (res: ServerResponse, status: number, body: unknown) => void
  close: () => Promise<void>
  /** When set, every request is aborted by the client before any response. */
}

function startSearxng(handler?: (res: ServerResponse) => void): Promise<SearxngFixture> {
  const queries: string[] = []
  const server = createServer((req, res) => {
    queries.push(new URL(req.url ?? '/', 'http://x').searchParams.get('q') ?? '')
    if (handler) return handler(res)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        results: [
          { title: 'First result', url: 'https://example.com/1', content: 'Useful snippet' },
          { title: 'Second result', url: 'https://example.com/2', content: 'Another snippet' },
        ],
      }),
    )
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') throw new Error('no address')
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        queries,
        respond: (res, status, body) => {
          res.writeHead(status, { 'content-type': 'application/json' })
          res.end(JSON.stringify(body))
        },
        close: () => new Promise((r) => server.close(() => r())),
      })
    })
  })
}

const env = (over: Record<string, string>) => ({ [WEB_SEARCH_URL_ENV]: over[WEB_SEARCH_URL_ENV] })

describe('BAZ-067 web search host', () => {
  test('is unconfigured without a URL and rejects invalid URLs', () => {
    expect(isWebSearchConfigured({})).toBe(false)
    expect(isWebSearchConfigured(env({ [WEB_SEARCH_URL_ENV]: ' ' }))).toBe(false)
    expect(isWebSearchConfigured(env({ [WEB_SEARCH_URL_ENV]: 'not a url' }))).toBe(false)
    // Plain http is only allowed for loopback.
    expect(isWebSearchConfigured(env({ [WEB_SEARCH_URL_ENV]: 'http://searx.example.com' }))).toBe(
      false,
    )
    expect(isWebSearchConfigured(env({ [WEB_SEARCH_URL_ENV]: 'https://searx.example.com' }))).toBe(
      true,
    )
    expect(isWebSearchConfigured(env({ [WEB_SEARCH_URL_ENV]: 'http://127.0.0.1:8888' }))).toBe(true)
    expect(isWebSearchConfigured(env({ [WEB_SEARCH_URL_ENV]: 'http://localhost:8888' }))).toBe(true)
  })

  test('returns bounded results from the configured backend', async () => {
    const fixture = await startSearxng()
    const host = createWebSearchHost({ env: () => env({ [WEB_SEARCH_URL_ENV]: fixture.url }) })
    const output = await host.search({ query: 'orchid care', count: 2 })
    expect(output.backend).toBe('searxng')
    expect(output.results).toHaveLength(2)
    expect(output.results[0]).toEqual({
      title: 'First result',
      url: 'https://example.com/1',
      snippet: 'Useful snippet',
    })
    expect(fixture.queries[0]).toBe('orchid care')
    await fixture.close()
  })

  test('caps oversized queries, counts and fields', async () => {
    const fixture = await startSearxng()
    const host = createWebSearchHost({ env: () => env({ [WEB_SEARCH_URL_ENV]: fixture.url }) })
    const huge = 'x'.repeat(10_000)
    const output = await host.search({ query: huge, count: 999 })
    expect(output.results.length).toBeLessThanOrEqual(8)
    for (const r of output.results) {
      expect(r.title.length).toBeLessThanOrEqual(200)
      expect(r.url.length).toBeLessThanOrEqual(2048)
      expect(r.snippet.length).toBeLessThanOrEqual(300)
    }
    const sent = fixture.queries[0] ?? ''
    expect(sent.length).toBeLessThanOrEqual(512)
    await fixture.close()
  })

  test('names the operator action when unconfigured, even mid-turn', async () => {
    const fixture = await startSearxng()
    let url: string | null = fixture.url
    const host = createWebSearchHost({ env: () => (url ? env({ [WEB_SEARCH_URL_ENV]: url }) : {}) })
    await expect(host.search({ query: 'x' })).resolves.toBeTruthy()
    // Configuration drift: the operator unsets the backend mid-turn.
    url = null
    await expect(host.search({ query: 'x' })).rejects.toThrow(/No web search backend is configured/)
    await fixture.close()
  })

  test('reports backend failures without echoing the URL or response body', async () => {
    const fixture = await startSearxng((res) => {
      res.writeHead(503).end('secret backend details')
    })
    const host = createWebSearchHost({ env: () => env({ [WEB_SEARCH_URL_ENV]: fixture.url }) })
    await expect(host.search({ query: 'x' })).rejects.toThrow(/status 503/)
    await expect(host.search({ query: 'x' })).rejects.not.toThrow(/secret/)
    await fixture.close()
  })

  test('rejects malformed and non-array backend responses', async () => {
    for (const body of [null, { results: 'nope' }, 'not json']) {
      const fixture = await startSearxng((res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(typeof body === 'string' ? body : JSON.stringify(body))
      })
      const host = createWebSearchHost({ env: () => env({ [WEB_SEARCH_URL_ENV]: fixture.url }) })
      await expect(host.search({ query: 'x' })).rejects.toThrow(/invalid response/)
      await fixture.close()
    }
  })

  test('one request per invocation, no internal retry; unreachable backend reports cleanly', async () => {
    const fixture = await startSearxng()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const host = createWebSearchHost({ env: () => env({ [WEB_SEARCH_URL_ENV]: fixture.url }) })
    await host.search({ query: 'once' })
    expect(fixture.queries).toHaveLength(1)
    fetchSpy.mockRestore()

    const dead = await startSearxng()
    await dead.close()
    const deadHost = createWebSearchHost({ env: () => env({ [WEB_SEARCH_URL_ENV]: dead.url }) })
    await expect(deadHost.search({ query: 'x' })).rejects.toThrow(/unreachable/)
    expect(dead.queries).toHaveLength(0)
  })

  test('an empty query is refused before any backend contact', async () => {
    const fixture = await startSearxng()
    const host = createWebSearchHost({ env: () => env({ [WEB_SEARCH_URL_ENV]: fixture.url }) })
    await expect(host.search({ query: '   ' })).rejects.toThrow(/non-empty query/)
    expect(fixture.queries).toHaveLength(0)
    await fixture.close()
  })
})
