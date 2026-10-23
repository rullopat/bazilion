import { createServer } from 'node:http'
import { zstdDecompressSync } from 'node:zlib'
import { stream } from '@earendil-works/pi-ai/api/openai-codex-responses'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { describe, expect, test, vi } from 'vitest'
import { nativeSearch } from '../../src/lib/native-search.ts'
import { SEARCH_ENDPOINTS } from '../../src/lib/ordinary-search-config.ts'

const TOKEN = `header.${Buffer.from(
  JSON.stringify({
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'offline_fixture_account',
    },
  }),
).toString('base64url')}.signature`

describe('offline native search and pinned Pi subscription request comparison', () => {
  test('SDK SSE headers and payload differ from native without enabling transport fallback', async () => {
    const model = getBuiltinModels('openai-codex').find((model) => model.id === 'gpt-6.1-sol')
    if (model?.api !== 'openai-codex-responses') throw new Error('Missing pinned fixture model')
    const sdkModel = { ...model, api: 'openai-codex-responses' as const }
    let sdkUrl: string | undefined
    let sdkHeaders: Headers | undefined
    let sdkBody: Record<string, unknown> | undefined
    const sdkFetch: typeof fetch = vi.fn(async (url, init) => {
      sdkUrl = String(url)
      sdkHeaders = new Headers(init?.headers)
      const bytes =
        typeof init?.body === 'string'
          ? Buffer.from(init.body)
          : Buffer.from(init?.body as Uint8Array)
      sdkBody = JSON.parse(
        (sdkHeaders.get('content-encoding') === 'zstd'
          ? zstdDecompressSync(bytes)
          : bytes
        ).toString('utf8'),
      )
      // Deliberate offline refusal: avoids exercising any hosted capability or retry.
      return Response.json({ error: { message: 'OFFLINE fixture refusal' } }, { status: 400 })
    })
    const sdkResult = await stream(
      sdkModel,
      normalizeContext({
        messages: [{ role: 'user', content: 'OFFLINE fixture', timestamp: 0 }],
      }),
      {
        apiKey: TOKEN,
        transport: 'sse',
        fetch: sdkFetch,
        maxRetries: 0,
        sessionId: 'offline_fixture_session',
        reasoningEffort: 'medium',
      },
    ).result()
    expect(sdkResult.stopReason).toBe('error')
    expect(sdkFetch).toHaveBeenCalledTimes(1)

    let nativeUrl: string | undefined
    let nativeHeaders: Headers | undefined
    let nativeBody: Record<string, unknown> | undefined
    const nativeFetch: typeof fetch = vi.fn(async (url, init) => {
      nativeUrl = String(url)
      nativeHeaders = new Headers(init?.headers)
      nativeBody = JSON.parse(String(init?.body))
      expect(init?.redirect).toBe('error')
      return new Response('OFFLINE fixture refusal', { status: 400 })
    })
    await expect(
      nativeSearch({
        provider: 'openai-codex',
        model: 'gpt-6.1-sol',
        mode: 'cached',
        args: { query: 'OFFLINE fixture', allowedDomains: ['nasa.gov'] },
        credential: async () => TOKEN,
        accountId: 'offline_fixture_account',
        secrets: () => [TOKEN],
        signal: new AbortController().signal,
        assertActive: () => {},
        fetchImpl: nativeFetch,
      }),
    ).rejects.toThrow('HTTP 400')
    expect(nativeFetch).toHaveBeenCalledTimes(1)
    expect(sdkUrl).toBe(SEARCH_ENDPOINTS['openai-codex'])
    expect(nativeUrl).toBe(sdkUrl)
    if (!sdkHeaders || !nativeHeaders || !sdkBody || !nativeBody)
      throw new Error('Missing fixture capture')
    for (const key of [
      'authorization',
      'chatgpt-account-id',
      'originator',
      'openai-beta',
      'accept',
      'content-type',
    ])
      expect(nativeHeaders.get(key)).toBe(sdkHeaders.get(key))
    expect(sdkHeaders.get('user-agent')).toMatch(/^pi\/1\.4\.0 \(/)
    expect(nativeHeaders.has('user-agent')).toBe(false)
    expect(sdkHeaders.get('session-id')).toBe('offline_fixture_session')
    expect(sdkHeaders.get('x-client-request-id')).toBe('offline_fixture_session')
    expect(nativeHeaders.has('session-id')).toBe(false)
    expect(nativeHeaders.has('x-client-request-id')).toBe(false)
    expect(sdkBody.tool_choice).toBe('auto')
    expect(nativeBody.tool_choice).toEqual({ type: 'web_search' })
    expect(nativeBody.tools).toEqual([
      {
        type: 'web_search',
        external_web_access: false,
        filters: { allowed_domains: ['nasa.gov'] },
      },
    ])
    expect(sdkBody.reasoning).toEqual({ effort: 'medium', summary: 'auto' })
    expect(nativeBody.reasoning).toBeUndefined()
    expect(nativeHeaders.has('content-encoding')).toBe(false)
    for (const body of [sdkBody, nativeBody]) {
      expect(body.model).toBe('gpt-6.1-sol')
      expect(body.store).toBe(false)
      expect(body.stream).toBe(true)
      expect(JSON.stringify(body)).not.toContain(TOKEN)
    }
  })

  test('Node fetch default User-Agent is observed only against an owned loopback fixture', async () => {
    let userAgent: string | undefined
    const server = createServer((req, res) => {
      userAgent = req.headers['user-agent']
      res.end('OFFLINE fixture')
    })
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing fixture address')
      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        signal: AbortSignal.timeout(5000),
      })
      await response.text()
      expect(userAgent).toBe('node')
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
  })
})
