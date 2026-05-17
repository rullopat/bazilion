import { afterEach, expect, test } from 'vitest'
import { createToolRegistry } from '../../src/runtime/tools/registry.ts'
import { webTools } from '../../src/runtime/tools/web.ts'
import { type MockServer, startMockServer } from './mock-server.ts'

let server: MockServer | null = null
afterEach(async () => {
  await server?.stop()
  server = null
})

async function startMock(handler: (req: Request) => Response | Promise<Response>): Promise<string> {
  server = await startMockServer(handler)
  return server.url
}

test('web_fetch fetches a plain text URL', async () => {
  const base = await startMock(
    () => new Response('hello plain', { headers: { 'content-type': 'text/plain' } }),
  )
  const tools = createToolRegistry(webTools({ fetchImpl: fetch, allowPrivate: true }))
  const result = await tools.invoke('web_fetch', JSON.stringify({ url: `${base}/doc` }))
  expect(result).toContain('hello plain')
})

test('web_fetch extracts readable content from HTML (strips scripts/nav/footer)', async () => {
  const html = `<html><head><title>Test Doc</title><script>evil()</script><style>.x{}</style></head>
    <body>
      <nav>skip nav</nav>
      <article>
        <h1>The Real Article</h1>
        <p>This is the primary body of the article and it is long enough to give Readability something to score. The fox jumps over the lazy dog. Repeat repeat repeat.</p>
        <p>A second paragraph of genuine content to satisfy any content-length thresholds.</p>
      </article>
      <footer>skip footer</footer>
    </body></html>`
  const base = await startMock(
    () => new Response(html, { headers: { 'content-type': 'text/html' } }),
  )
  const tools = createToolRegistry(webTools({ fetchImpl: fetch, allowPrivate: true }))
  const result = await tools.invoke('web_fetch', JSON.stringify({ url: `${base}/page` }))
  expect(result).toContain('primary body of the article')
  expect(result).not.toContain('evil()')
  expect(result).not.toContain('<script')
  expect(result).not.toContain('skip nav')
  expect(result).not.toContain('skip footer')
})

test('web_fetch includes title as markdown heading', async () => {
  const html = `<html><head><title>My Awesome Post</title></head>
    <body><article><h1>My Awesome Post</h1>
      <p>Body text that is long enough to trigger Readability scoring here, filler filler filler filler.</p>
      <p>Another solid paragraph so Readability has plenty to work with.</p>
    </article></body></html>`
  const base = await startMock(
    () => new Response(html, { headers: { 'content-type': 'text/html' } }),
  )
  const tools = createToolRegistry(webTools({ fetchImpl: fetch, allowPrivate: true }))
  const result = await tools.invoke('web_fetch', JSON.stringify({ url: `${base}/post` }))
  expect(result).toMatch(/^#\s+My Awesome Post/)
})

test('web_fetch pretty-prints JSON responses', async () => {
  const base = await startMock(
    () => new Response('{"a":1,"b":[2,3]}', { headers: { 'content-type': 'application/json' } }),
  )
  const tools = createToolRegistry(webTools({ fetchImpl: fetch, allowPrivate: true }))
  const result = await tools.invoke('web_fetch', JSON.stringify({ url: `${base}/data.json` }))
  expect(result).toContain('"a": 1')
  expect(result).toContain('"b": [')
})

test('web_fetch truncates at max_length', async () => {
  const base = await startMock(
    () => new Response('a'.repeat(500), { headers: { 'content-type': 'text/plain' } }),
  )
  const tools = createToolRegistry(webTools({ fetchImpl: fetch, allowPrivate: true }))
  const result = await tools.invoke(
    'web_fetch',
    JSON.stringify({ url: `${base}/big`, max_length: 100 }),
  )
  expect(result).toContain('[truncated at 100 chars]')
  expect(result.length).toBeLessThan(200)
})

test('web_fetch throws on non-2xx', async () => {
  const base = await startMock(() => new Response('nope', { status: 404 }))
  const tools = createToolRegistry(webTools({ fetchImpl: fetch, allowPrivate: true }))
  await expect(
    tools.invoke('web_fetch', JSON.stringify({ url: `${base}/missing` })),
  ).rejects.toThrow(/404/)
})

test('web_fetch caches results per (url, extract_mode)', async () => {
  let hits = 0
  const base = await startMock(() => {
    hits += 1
    return new Response(
      '<html><body><article><p>Cached content here, enough words to pass threshold filler filler.</p></article></body></html>',
      {
        headers: { 'content-type': 'text/html' },
      },
    )
  })
  const tools = createToolRegistry(webTools({ fetchImpl: fetch, allowPrivate: true }))
  const first = await tools.invoke('web_fetch', JSON.stringify({ url: `${base}/cached` }))
  const second = await tools.invoke('web_fetch', JSON.stringify({ url: `${base}/cached` }))
  expect(first).toBe(second)
  expect(hits).toBe(1)
})

test('web_fetch blocks private IP literals by default', async () => {
  const tools = createToolRegistry(webTools())
  await expect(
    tools.invoke('web_fetch', JSON.stringify({ url: 'http://127.0.0.1/' })),
  ).rejects.toThrow(/private/i)
})

test('web_fetch blocks localhost by default', async () => {
  const tools = createToolRegistry(webTools())
  await expect(
    tools.invoke('web_fetch', JSON.stringify({ url: 'http://localhost/' })),
  ).rejects.toThrow(/Blocked hostname/i)
})

test('web_fetch blocks non-http(s) schemes', async () => {
  const tools = createToolRegistry(webTools({ allowPrivate: true }))
  await expect(
    tools.invoke('web_fetch', JSON.stringify({ url: 'file:///etc/passwd' })),
  ).rejects.toThrow(/http or https/i)
})

test('web_search tools are registered', () => {
  const tools = createToolRegistry(webTools())
  expect(tools.has('web_search')).toBe(true)
  expect(tools.has('web_fetch')).toBe(true)
})

test('web_search rejects empty query', async () => {
  const tools = createToolRegistry(webTools())
  await expect(tools.invoke('web_search', JSON.stringify({ query: '' }))).rejects.toThrow(
    /query is required/,
  )
})

test('web_search errors when no backend is configured', async () => {
  const tools = createToolRegistry(webTools({ env: {} }))
  await expect(tools.invoke('web_search', JSON.stringify({ query: 'test' }))).rejects.toThrow(
    /no search backend configured/,
  )
})

test('web_search uses Brave when BRAVE_API_KEY is set', async () => {
  let capturedHeaders = null as Headers | null
  const base = await startMock((req) => {
    capturedHeaders = req.headers
    return new Response(
      JSON.stringify({
        web: {
          results: [
            {
              title: 'Weather Krakow',
              url: 'https://weather.example.com/krakow',
              description: 'Sunny, 22°C',
            },
          ],
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    )
  })
  const tools = createToolRegistry(
    webTools({
      fetchImpl: async (input, init) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        const redirected = url.replace('https://api.search.brave.com', base)
        return fetch(redirected, init)
      },
      env: { BRAVE_API_KEY: 'test-key' },
    }),
  )
  const result = await tools.invoke('web_search', JSON.stringify({ query: 'weather krakow' }))
  expect(result).toContain('Weather Krakow')
  expect(result).toContain('Sunny')
  expect(result).toContain('weather.example.com')
  expect(capturedHeaders?.get('x-subscription-token')).toBe('test-key')
})

test('web_search uses SearXNG when SEARXNG_URL is set', async () => {
  const base = await startMock(
    () =>
      new Response(
        JSON.stringify({
          results: [
            { title: 'News', url: 'https://news.example.com', content: 'Latest headlines' },
          ],
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  )
  const tools = createToolRegistry(webTools({ env: { SEARXNG_URL: base } }))
  const result = await tools.invoke('web_search', JSON.stringify({ query: 'news' }))
  expect(result).toContain('News')
  expect(result).toContain('Latest headlines')
})
