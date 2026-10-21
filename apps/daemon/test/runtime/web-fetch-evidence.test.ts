import { describe, expect, test, vi } from 'vitest'
import { ourToolToPiTool } from '../../src/runtime/pi/tools.ts'
import { webTools } from '../../src/runtime/tools/web.ts'

function tool(fetchImpl: typeof fetch, env: NodeJS.ProcessEnv = {}) {
  const source = webTools({ fetchImpl, allowPrivate: true, sourceReceipt: true, env }).find(
    (t) => t.def.name === 'web_fetch',
  )
  if (!source) throw new Error('Missing fixture tool')
  return source
}

describe('ordinary source fetch evidence', () => {
  test('direct redirect, cache and display truncation preserve original effective URL/time', async () => {
    const fetcher = vi.fn(async (_input: unknown) =>
      fetcher.mock.calls.length === 1
        ? new Response(null, {
            status: 302,
            headers: { location: 'https://www.nasa.gov/mission/artemis-ii/' },
          })
        : new Response('Offline source text '.repeat(50), {
            headers: { 'content-type': 'text/plain' },
          }),
    )
    const source = tool(fetcher)
    const first = await source.invoke({ url: 'https://www.nasa.gov/old' })
    if (typeof first !== 'object' || Array.isArray(first) || !('webFetch' in first))
      throw new Error('Missing receipt')
    expect(first.webFetch).toMatchObject({
      requestedUrl: 'https://www.nasa.gov/old',
      finalUrl: 'https://www.nasa.gov/mission/artemis-ii/',
      status: 200,
      renderer: 'direct',
      cacheHit: false,
      truncated: false,
    })
    const pi = ourToolToPiTool(source)
    const cached = await pi.execute(
      'cached',
      { url: 'https://www.nasa.gov/old', max_length: 10 },
      undefined,
      undefined,
      {} as Parameters<typeof pi.execute>[4],
    )
    expect(cached.details).toMatchObject({
      webFetch: {
        finalUrl: first.webFetch.finalUrl,
        fetchedAt: first.webFetch.fetchedAt,
        cacheHit: true,
        truncated: true,
      },
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  test.each([
    'https://example.com/different-source',
    undefined,
    'https://example.com/' + 'é'.repeat(900),
  ])('Firecrawl never inherits direct provenance, even from cache (%s)', async (url) => {
    const fetcher = vi.fn(async (input: unknown) =>
      String(input).includes('firecrawl')
        ? Response.json({
            success: true,
            data: { markdown: 'OFFLINE RENDERED SOURCE', metadata: { url, statusCode: 404 } },
          })
        : new Response('<html><body><main>Loading...</main></body></html>', {
            headers: { 'content-type': 'text/html' },
          }),
    )
    const source = tool(fetcher, { FIRECRAWL_API_KEY: 'fixture-firecrawl-key' })
    let time: number | undefined
    for (let n = 0; n < 2; n++) {
      const result = await source.invoke({ url: 'https://www.nasa.gov/original' })
      if (typeof result !== 'object' || Array.isArray(result) || !('webFetch' in result))
        throw new Error('Missing receipt')
      expect(result.webFetch).toMatchObject({
        finalUrl: null,
        status: null,
        renderer: 'firecrawl',
        cacheHit: n === 1,
        directFetch: { finalUrl: 'https://www.nasa.gov/original', status: 200 },
        rendererReported: {
          status: 404,
          url: url === 'https://example.com/different-source' ? url : null,
        },
      })
      if (n === 0) time = result.webFetch.fetchedAt
      else expect(result.webFetch.fetchedAt).toBe(time)
    }
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
