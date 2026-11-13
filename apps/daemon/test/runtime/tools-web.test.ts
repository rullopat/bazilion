import { afterEach, expect, test } from 'vitest'
import { type WebFetchOpts, webFetchTool } from '../../src/runtime/tools/web.ts'
import { isPrivateIpAddress } from '../../src/runtime/tools/web-ssrf.ts'
import { createToolRegistry } from '../fixtures/tool-registry.ts'
import { type MockServer, startMockServer } from './mock-server.ts'

const webTools = (opts?: WebFetchOpts) => [webFetchTool(opts)]

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
  expect(typeof result === 'string' && result.length).toBeLessThan(200)
})

test('web_fetch caps oversized bodies before extraction and flags truncation', async () => {
  // 50 KB body — easily over a 1 KB cap. Plain text so the reader path runs.
  const big = 'x'.repeat(50_000)
  const base = await startMock(
    () => new Response(big, { headers: { 'content-type': 'text/plain' } }),
  )
  const tools = createToolRegistry(
    webTools({ fetchImpl: fetch, allowPrivate: true, maxBodyBytes: 1024 }),
  )
  const result = await tools.invoke('web_fetch', JSON.stringify({ url: `${base}/huge` }))
  expect(result).toContain('raw body truncated at 1024 bytes')
})

test('web_fetch unwraps err.cause so the agent sees the real reason', async () => {
  // Force a fetch failure with a stacked cause chain.
  const tools = createToolRegistry(
    webTools({
      allowPrivate: true,
      fetchImpl: async () => {
        const cause = new Error('socket hang up')
        ;(cause as { code?: string }).code = 'ECONNRESET'
        throw Object.assign(new TypeError('fetch failed'), { cause })
      },
    }),
  )
  await expect(
    tools.invoke('web_fetch', JSON.stringify({ url: 'https://example.com/' })),
  ).rejects.toThrow(/ECONNRESET[\s\S]*socket hang up/)
})

test('web_fetch falls back to Firecrawl when primary extraction is too thin', async () => {
  // JS shell: 2xx HTML but virtually no extractable body. Readability will
  // produce a near-empty result, which should trigger the fallback.
  let primaryHits = 0
  let firecrawlHits = 0
  let firecrawlBody: unknown = null
  let firecrawlAuth: string | null = null
  const base = await startMock(async (req) => {
    const u = new URL(req.url)
    if (u.pathname === '/v1/scrape') {
      firecrawlHits += 1
      firecrawlAuth = req.headers.get('authorization')
      firecrawlBody = await req.json()
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: '# Rendered Page\n\nFull article body after JS execution.',
            metadata: { title: 'Rendered Page' },
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    }
    primaryHits += 1
    return new Response(
      '<html><head><title>Loading</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
      { headers: { 'content-type': 'text/html' } },
    )
  })
  const tools = createToolRegistry(
    webTools({
      fetchImpl: fetch,
      allowPrivate: true,
      env: { FIRECRAWL_API_KEY: 'fc-test', FIRECRAWL_URL: base },
    }),
  )
  const result = await tools.invoke('web_fetch', JSON.stringify({ url: `${base}/spa` }))
  expect(primaryHits).toBe(1)
  expect(firecrawlHits).toBe(1)
  expect(firecrawlAuth).toBe('Bearer fc-test')
  expect(firecrawlBody).toMatchObject({
    url: `${base}/spa`,
    formats: ['markdown'],
    onlyMainContent: true,
  })
  expect(result).toContain('Full article body after JS execution.')
  expect(result).toContain('content rendered via Firecrawl fallback')
})

test('web_fetch leaves primary extraction alone when FIRECRAWL_API_KEY is unset', async () => {
  let firecrawlHits = 0
  const base = await startMock(async (req) => {
    const u = new URL(req.url)
    if (u.pathname === '/v1/scrape') {
      firecrawlHits += 1
      return new Response('should not be called', { status: 500 })
    }
    return new Response('<html><body><div></div></body></html>', {
      headers: { 'content-type': 'text/html' },
    })
  })
  const tools = createToolRegistry(
    webTools({ fetchImpl: fetch, allowPrivate: true, env: { FIRECRAWL_URL: base } }),
  )
  const result = await tools.invoke('web_fetch', JSON.stringify({ url: `${base}/spa` }))
  expect(firecrawlHits).toBe(0)
  expect(result).not.toContain('Firecrawl')
})

test('web_fetch swallows Firecrawl failures and returns primary extraction', async () => {
  const base = await startMock((req) => {
    const u = new URL(req.url)
    if (u.pathname === '/v1/scrape') {
      return new Response('{"error":"rate limited"}', { status: 429 })
    }
    return new Response('<html><body><p>tiny</p></body></html>', {
      headers: { 'content-type': 'text/html' },
    })
  })
  const tools = createToolRegistry(
    webTools({
      fetchImpl: fetch,
      allowPrivate: true,
      env: { FIRECRAWL_API_KEY: 'fc-test', FIRECRAWL_URL: base },
    }),
  )
  const result = await tools.invoke('web_fetch', JSON.stringify({ url: `${base}/spa` }))
  expect(result).not.toContain('Firecrawl')
  expect(result).not.toThrow
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

test.each([
  ['mapped loopback', 'http://[::ffff:127.0.0.1]/'],
  ['mapped private', 'http://[::ffff:10.0.0.1]/'],
  ['mapped link-local', 'http://[::ffff:169.254.1.1]/'],
  ['mapped metadata', 'http://[::ffff:169.254.169.254]/'],
  ['historical translated loopback', 'http://[::ffff:0:127.0.0.1]/'],
  ['NAT64 translated metadata', 'http://[64:ff9b::169.254.169.254]/'],
])('web_fetch blocks WHATWG-normalized IPv6 %s literals', async (_name, url) => {
  const tools = createToolRegistry(webTools())
  await expect(tools.invoke('web_fetch', JSON.stringify({ url }))).rejects.toThrow(/private/i)
})

test.each([
  ['mapped loopback (dotted)', '::ffff:127.0.0.1'],
  ['mapped loopback (hex)', '::ffff:7f00:1'],
  ['mapped private', '::ffff:a00:1'],
  ['mapped link-local', '::ffff:a9fe:101'],
  ['mapped metadata', '::ffff:a9fe:a9fe'],
  ['historical translated loopback', '::ffff:0:7f00:1'],
  ['historical translated metadata', '::ffff:0:a9fe:a9fe'],
  ['NAT64 translated loopback', '64:ff9b::7f00:1'],
  ['NAT64 translated metadata', '64:ff9b::a9fe:a9fe'],
  ['local-use translated loopback', '64:ff9b:1:7f00:0:100::'],
  ['6to4 loopback', '2002:7f00:1::'],
  ['full link-local /10 range', 'fe90::1'],
])('classifies private resolver result: %s', (_name, address) => {
  expect(isPrivateIpAddress(address)).toBe(true)
})

test.each([
  ['mapped public IPv4', '::ffff:808:808'],
  ['NAT64 public IPv4', '64:ff9b::808:808'],
  ['public IPv6', '2001:4860:4860::8888'],
])('does not overblock public resolver result: %s', (_name, address) => {
  expect(isPrivateIpAddress(address)).toBe(false)
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

test('web tools provide only web_fetch; search is daemon-owned', () => {
  const tools = createToolRegistry(webTools())
  expect(tools.has('web_fetch')).toBe(true)
  expect(tools.has('web_search')).toBe(false)
})
