import type { WebSearchArgs } from '@bazilion/api-types'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  NativeSearchError,
  nativeSearch,
  projectNativeSearch,
  SEARCH_RESPONSE_BYTES,
  validateSearchArgs,
} from '../../src/lib/native-search.ts'
import {
  nativeSearchModel,
  ordinarySearchStatus,
  SEARCH_ENDPOINTS,
} from '../../src/lib/ordinary-search-config.ts'
import {
  bindOrdinarySearchWire,
  createOrdinaryWebSearchHost,
} from '../../src/lib/ordinary-web-search.ts'

const MODEL = 'gpt-6.1-sol'
const KEY = 'selected-api-secret-12345'
const TOKEN = `header.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'account_123' } })).toString('base64url')}.signature`
function evidence() {
  return {
    id: 'resp_123',
    model: MODEL,
    status: 'completed',
    usage: { input_tokens: 20, output_tokens: 40, total_tokens: 60 },
    output: [
      {
        id: 'ws_123',
        type: 'web_search_call',
        status: 'completed',
        action: { type: 'search', query: 'Artemis II' },
      },
      {
        id: 'msg_123',
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: 'NASA describes Artemis II.',
            annotations: [
              {
                type: 'url_citation',
                url: 'https://www.nasa.gov/mission/artemis-ii/',
                title: 'Artemis II',
                start_index: 0,
                end_index: 4,
              },
            ],
          },
        ],
      },
    ],
  }
}
function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing fixture value')
  return value
}
function textPart(value: ReturnType<typeof evidence>) {
  return requireValue(requireValue(value.output[1]).content?.[0])
}
function opts(fetchImpl: typeof fetch, extra = {}) {
  return {
    provider: 'openai' as const,
    model: MODEL,
    mode: 'cached' as const,
    args: { query: 'Artemis II' },
    credential: async () => KEY,
    secrets: () => [KEY],
    signal: new AbortController().signal,
    assertActive: () => {},
    fetchImpl,
    ...extra,
  }
}
function response(value: unknown = evidence()) {
  return Response.json(value)
}
function fake(value: unknown = evidence()) {
  return vi.fn(async () => response(value)) as unknown as typeof fetch
}
function host(env: NodeJS.ProcessEnv, fetchImpl = fake(), extra = {}) {
  return createOrdinaryWebSearchHost({
    env: () => env,
    model: `openai:${MODEL}`,
    codexConnected: () => true,
    codexAccountId: () => 'account_123',
    codexCredential: async () => TOKEN,
    signal: new AbortController().signal,
    assertActive: () => {},
    fetchImpl,
    ...extra,
  })
}
afterEach(() => vi.restoreAllMocks())

describe('BAZ-069 deterministic ordinary discovery admission', () => {
  test('binds trusted wire admission once before use, after argument validation', async () => {
    const fetcher = vi.fn(async () => Response.json({ results: [] })) as unknown as typeof fetch
    const search = host({ SEARXNG_URL: 'https://fixture-search.test' }, fetcher)
    let wires = 0,
      bodies = 0
    bindOrdinarySearchWire(search, async (perform) => {
      wires++
      const response = await perform()
      const body = await response.text()
      bodies++
      return new Response(body, { status: response.status, headers: response.headers })
    })
    expect(() => bindOrdinarySearchWire(search, async (perform) => perform())).toThrow(
      'native_search_admission_refused',
    )
    await expect(search.search({ query: '' })).rejects.toThrow()
    expect(wires).toBe(0)
    await expect(search.search({ query: 'fixture query' })).resolves.toMatchObject({ results: [] })
    expect(wires).toBe(1)
    expect(bodies).toBe(1)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(() => bindOrdinarySearchWire({}, async (perform) => perform())).toThrow(
      'native_search_admission_refused',
    )
  })
  test('preserves managed priority and chooses only current eligible OpenAI account', () => {
    expect(
      ordinarySearchStatus({
        env: { BRAVE_API_KEY: KEY, SEARXNG_URL: 'https://searx.test' },
        model: `openai:${MODEL}`,
      }).route,
    ).toBe('brave')
    expect(
      ordinarySearchStatus({ env: { SEARXNG_URL: 'https://searx.test' }, model: `openai:${MODEL}` })
        .route,
    ).toBe('searxng')
    expect(
      ordinarySearchStatus({ env: { OPENAI_API_KEY: KEY }, model: `openai:${MODEL}` }).route,
    ).toBe('openai')
    expect(
      ordinarySearchStatus({
        env: { OPENAI_API_KEY: KEY },
        model: `openai-codex:${MODEL}`,
        codexConnected: true,
      }).account,
    ).toBe('subscription')
    expect(
      ordinarySearchStatus({
        env: { OPENAI_API_KEY: KEY },
        model: 'anthropic:claude-opus-5',
        codexConnected: true,
      }).state,
    ).toBe('unavailable')
  })
  test.each([
    { BAZILION_WEB_SEARCH: 'off' },
    { BAZILION_WEB_SEARCH: 'oops' },
    { BAZILION_WEB_SEARCH_ROUTE: 'unknown' },
    { BAZILION_WEB_SEARCH_MODE: 'unknown' },
    { BAZILION_WEB_SEARCH_ROUTE: 'brave' },
    { BAZILION_WEB_SEARCH_ROUTE: 'searxng' },
    { BAZILION_WEB_SEARCH_ROUTE: 'openai-codex' },
    { OPENAI_BASE_URL: 'https://evil.test' },
  ])('unavailable/disabled selection never silently falls through: %j', (env) => {
    const s = ordinarySearchStatus({
      env: { OPENAI_API_KEY: KEY, ...env },
      model: `openai:${MODEL}`,
      codexConnected: true,
    })
    expect(s.state).not.toBe('configured')
    expect(s.message).not.toContain(KEY)
  })
  test.each([
    'unknown',
    'gpt-4',
    'gpt-4.1-nano',
    'o3',
    'gpt-realtime-2.1',
    'gpt-5.3-codex-spark',
    'gpt-6.2-sol',
  ])('unknown/unadmitted native model %s', (id) => {
    expect(nativeSearchModel('openai', id)).toBe(false)
    expect(
      ordinarySearchStatus({ env: { OPENAI_API_KEY: KEY }, model: `openai:${id}` }).state,
    ).toBe('unavailable')
  })
  test('configured is experimental, no network and not proof of entitlement', () => {
    const h = host({ OPENAI_API_KEY: KEY })
    expect(h.status.qualification).toBe('unqualified')
    expect(h.status.message).toContain('Live qualification pending')
    const s = ordinarySearchStatus({
      env: { OPENAI_API_KEY: KEY },
      model: `openai:${MODEL}`,
      admitted: false,
    })
    expect(s.state).toBe('disabled')
  })
  test.each([
    'https://user:password@searx.test',
    'https://searx.test?key=secret',
    'https://searx.test/#x',
    'http://external.test',
  ])('managed invalid URL is not another route: %s', (url) => {
    expect(
      ordinarySearchStatus({
        env: { SEARXNG_URL: url, OPENAI_API_KEY: KEY },
        model: `openai:${MODEL}`,
      }).state,
    ).toBe('unavailable')
  })
})

describe('native query-only transport, evidence and bounds', () => {
  test('official API: one request, same model, only hosted search, no context/files/functions', async () => {
    const fetcher = vi.fn(async (_url, _init) => response())
    const output = await nativeSearch(opts(fetcher as typeof fetch))
    expect(output).toMatchObject({
      kind: 'grounded_answer',
      backend: 'openai',
      model: MODEL,
      citations: [{ url: 'https://www.nasa.gov/mission/artemis-ii/' }],
      evidence: { responseId: 'resp_123', searchCallIds: ['ws_123'], observedMode: 'unknown' },
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, rawInit] = requireValue(fetcher.mock.calls[0])
    const init = requireValue(rawInit)
    expect(url).toBe(SEARCH_ENDPOINTS.openai)
    expect(init.redirect).toBe('error')
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe(MODEL)
    expect(body.tools).toEqual([{ type: 'web_search', external_web_access: false }])
    expect(body.input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'Artemis II' }] },
    ])
    expect(body.store).toBe(false)
    expect(JSON.stringify(body)).not.toContain(KEY)
  })
  test('subscription: selected daemon token/account, SSE projection and requested live mode', async () => {
    const fetcher = vi.fn(
      async (_url, _init) =>
        new Response(
          `event: response.completed\r\ndata: ${JSON.stringify({ type: 'response.completed', response: evidence() })}\r\n\r\ndata: [DONE]\r\n\r\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    )
    const output = await nativeSearch({
      ...opts(fetcher as typeof fetch),
      provider: 'openai-codex',
      accountId: 'account_123',
      credential: async () => TOKEN,
      mode: 'live',
      args: { query: 'Artemis II', allowedDomains: ['nasa.gov'] },
    })
    expect(output.backend).toBe('openai-codex')
    expect(output.evidence.requestedMode).toBe('live')
    expect(output.evidence.observedMode).toBe('unknown')
    const [url, rawInit] = requireValue(fetcher.mock.calls[0])
    const init = requireValue(rawInit)
    expect(url).toBe(SEARCH_ENDPOINTS['openai-codex'])
    expect(init.headers).toMatchObject({
      'chatgpt-account-id': 'account_123',
      authorization: `Bearer ${TOKEN}`,
    })
    expect(JSON.parse(String(init.body)).tools[0]).toMatchObject({
      external_web_access: true,
      filters: { allowed_domains: ['nasa.gov'] },
    })
  })
  test.each([
    {},
    { query: '' },
    { query: 'x'.repeat(513) },
    { query: 'x', count: NaN },
    { query: 'x', count: 0 },
    { query: 'x', count: 1.5 },
    { query: 'x', model: 'other' },
    { query: 'x', tools: [] },
    { query: 'x', allowedDomains: ['localhost'] },
    { query: 'x', allowedDomains: ['nasa.gov/path'] },
  ])('rejects invalid/authority-widening args: %j', (args) => {
    expect(() => validateSearchArgs(args as WebSearchArgs)).toThrow()
  })
  test.each([
    'failed',
    'incomplete',
    'cancelled',
    'in_progress',
  ])('refuses terminal %s despite plausible answer', async (status) => {
    await expect(nativeSearch(opts(fake({ ...evidence(), status })))).rejects.toThrow(/incomplete/)
  })
  test('missing search, annotations, model identity, unsupported tools and out-of-domain citations refuse', () => {
    const project = (value: unknown, extra = {}) =>
      projectNativeSearch(value, {
        provider: 'openai',
        model: MODEL,
        mode: 'cached',
        count: 5,
        ...extra,
      })
    expect(() => project({ ...evidence(), output: evidence().output.slice(1) })).toThrow(
      /execution/,
    )
    expect(() => project({ ...evidence(), model: 'substituted' })).toThrow(/identity/)
    const bad = evidence()
    textPart(bad).annotations = []
    expect(() => project(bad)).toThrow(/citations/)
    const wide = evidence()
    wide.output.push({ type: 'function_call' } as never)
    expect(() => project(wide)).toThrow(/capability/)
    expect(() => project(evidence(), { allowedDomains: ['esa.int'] })).toThrow(/restriction/)
  })
  test.each([
    'javascript:alert(1)',
    'file:///etc/passwd',
    'https://user:password@example.com',
    'https://example.com/' + 'x'.repeat(2049),
  ])('refuses unsafe citation %s', async (url) => {
    const value = evidence()
    requireValue(textPart(value).annotations[0]).url = url
    await expect(nativeSearch(opts(fake(value)))).rejects.toThrow(/citation/)
  })
  test('encoded/prose/query credential material is never disclosed', async () => {
    const fetcher = fake()
    await expect(nativeSearch({ ...opts(fetcher), args: { query: KEY } })).rejects.toThrow(
      /credential/,
    )
    expect(fetcher).not.toHaveBeenCalled()
    const value = evidence()
    textPart(value).text += ` ${KEY}`
    const escaped = JSON.stringify(value).replaceAll(
      KEY,
      [...KEY].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join(''),
    )
    await expect(
      nativeSearch(
        opts(
          async () => new Response(escaped, { headers: { 'content-type': 'application/json' } }),
        ),
      ),
    ).rejects.toThrow(/credential/)
  })
  test.each([
    401, 403, 429, 500,
  ])('HTTP %s has one request, no body disclosure or retry', async (status) => {
    const fetcher = vi.fn(async () => new Response(KEY, { status }))
    await expect(nativeSearch(opts(fetcher))).rejects.toThrow(`HTTP ${status}`)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  test.each([
    'data: {"type":"response.output_text.delta","delta":"I searched"}\n\n',
    'data: {"type":"response.failed"}\n\n',
    'not json',
  ])('refuses incomplete/malformed stream', async (body) => {
    await expect(
      nativeSearch(
        opts(async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } })),
      ),
    ).rejects.toThrow()
  })
  test('duplicate terminal, unsupported post-terminal item and failed search call refuse', async () => {
    const terminal = `data: ${JSON.stringify({ type: 'response.completed', response: evidence() })}\n\n`
    for (const suffix of [terminal, 'data: {"type":"response.output_text.delta"}\n\n'])
      await expect(
        nativeSearch(
          opts(
            async () =>
              new Response(terminal + suffix, { headers: { 'content-type': 'text/event-stream' } }),
          ),
        ),
      ).rejects.toThrow()
    const value = evidence()
    requireValue(value.output[0]).status = 'in_progress'
    await expect(nativeSearch(opts(fake(value)))).rejects.toThrow(/did not complete/)
  })
  test('incremental upstream and return budgets fail, never truncation-as-success', async () => {
    await expect(
      nativeSearch(opts(async () => new Response(new Uint8Array(SEARCH_RESPONSE_BYTES + 1)))),
    ).rejects.toThrow(/budget/)
    const value = evidence()
    textPart(value).text = 'x'.repeat(32 * 1024)
    await expect(nativeSearch(opts(fake(value)))).rejects.toThrow(/budget/)
  })
  test('abort retires stalled OAuth and body without waiting on cleanup', async () => {
    const ac = new AbortController()
    const pending = nativeSearch({
      ...opts(fake()),
      signal: ac.signal,
      credential: () => new Promise<string>(() => {}),
    })
    ac.abort()
    await expect(pending).rejects.toThrow(/cancelled/)
    const ac2 = new AbortController()
    const reader = new ReadableStream({ start() {}, cancel: () => new Promise<void>(() => {}) })
    const pending2 = nativeSearch({ ...opts(async () => new Response(reader)), signal: ac2.signal })
    await new Promise((resolve) => setTimeout(resolve, 1))
    ac2.abort()
    await expect(pending2).rejects.toThrow(/cancelled/)
  })
  test('absolute deadline rejects even timer-delayed completed evidence', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    await expect(
      nativeSearch(
        opts(async () => {
          now = 31_000
          return response()
        }),
      ),
    ).rejects.toThrow(/deadline/)
  })
})

describe('Codex missing-MIME stream contract', () => {
  const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`
  const terminal = (value: unknown = evidence(), type = 'response.completed') =>
    event({ type, response: value })
  // String Response bodies acquire text/plain automatically; bytes preserve missing MIME.
  const upstream = (body: string, media?: string) =>
    new Response(new TextEncoder().encode(body), {
      headers: media === undefined ? {} : { 'content-type': media },
    })
  const codex = (fetcher: typeof fetch) => ({
    ...opts(fetcher),
    provider: 'openai-codex' as const,
    accountId: 'account_123',
    credential: async () => TOKEN,
    args: { query: 'Artemis II', allowedDomains: ['nasa.gov'] },
  })

  test('absent or blank MIME accepts only complete validated Codex SSE in one request', async () => {
    for (const media of [undefined, '', '   ', 'Text/Event-Stream; charset=UTF-8']) {
      const fetcher = vi.fn(async () =>
        upstream(`: heartbeat\n\n${terminal()}data: [DONE]\n\n`, media),
      )
      const output = await nativeSearch(codex(fetcher))
      expect(output).toMatchObject({
        backend: 'openai-codex',
        model: MODEL,
        evidence: { responseId: 'resp_123', searchCallIds: ['ws_123'], observedMode: 'unknown' },
      })
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
  })
  test('codec comes from provider and request contract, never a prefix hint or decoder retry', async () => {
    // A blank inspected prefix is unknown, but the complete stream is valid.
    const comments = `:${' '.repeat(1100)}\n\n${terminal()}`
    await expect(nativeSearch(codex(async () => upstream(comments)))).resolves.toHaveProperty(
      'kind',
      'grounded_answer',
    )
    const json = JSON.stringify(evidence())
    await expect(nativeSearch(codex(async () => upstream(json)))).rejects.toThrow(/SSE/)
    await expect(
      nativeSearch(codex(async () => upstream(json, 'application/json'))),
    ).resolves.toHaveProperty('kind', 'grounded_answer')
    await expect(nativeSearch(opts(async () => upstream(terminal())))).rejects.toThrow(
      /invalid_json/,
    )
    await expect(nativeSearch(opts(async () => upstream(json)))).resolves.toHaveProperty(
      'kind',
      'grounded_answer',
    )
    await expect(
      nativeSearch(codex(async () => upstream(terminal(), 'application/json'))),
    ).rejects.toThrow(/invalid_json/)
  })
  test('populated unadmitted MIME refuses even with convincing SSE or JSON evidence', async () => {
    for (const media of [
      'text/plain',
      'text/html',
      'application/octet-stream',
      'application/vendor+json',
      '; charset=utf-8',
    ]) {
      for (const body of [terminal(), JSON.stringify(evidence())]) {
        const fetcher = vi.fn(async () => upstream(body, media))
        await expect(nativeSearch(codex(fetcher))).rejects.toThrow(
          /unsupported subscription response media/,
        )
        expect(fetcher).toHaveBeenCalledTimes(1)
      }
    }
  })
  test('missing-MIME HTML, prose, malformed frames and conflicting event labels refuse', async () => {
    for (const body of [
      '<!doctype html><html>private upstream</html>',
      '',
      ': heartbeat\n\n',
      `private upstream\n\n${terminal()}`,
      `data: {}\nprivate upstream\n\n${terminal()}`,
      `event: response.failed\n${terminal()}`,
      `event: response.failed\n\n${terminal()}`,
      `${terminal()}event: response.failed\ndata: [DONE]\n\n`,
      `event: response.completed\nevent: response.completed\n${terminal()}`,
      'data: private upstream\n\n',
    ]) {
      const fetcher = vi.fn(async () => upstream(body))
      const error = await nativeSearch(codex(fetcher)).catch((error: unknown) => error)
      expect(error).toBeInstanceOf(NativeSearchError)
      expect((error as Error).message).not.toContain('private upstream')
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
  })
  test('explicit SSE on both routes rejects the reviewed field and label attacks', async () => {
    for (const provider of ['openai', 'openai-codex'] as const) {
      for (const body of [
        `private upstream\n\n${terminal()}`,
        `data: {}\nprivate upstream\n\n${terminal()}`,
        `event: response.failed\n${terminal()}`,
        `event: response.failed\n\n${terminal()}`,
        `event: response.completed\nevent: response.completed\n${terminal()}`,
        `${terminal()}event: response.failed\ndata: [DONE]\n\n`,
      ]) {
        const fetcher = vi.fn(async () => upstream(body, 'text/event-stream'))
        const request = provider === 'openai' ? opts(fetcher) : codex(fetcher)
        const error = await nativeSearch(request).catch((error: unknown) => error)
        expect(error).toBeInstanceOf(NativeSearchError)
        expect((error as NativeSearchError).diagnostic?.phase).toBe('decode')
        expect((error as Error).message).not.toContain('private upstream')
        expect(fetcher).toHaveBeenCalledTimes(1)
      }
    }
  })
  test('Codex cancellation after a missing-MIME body read has stalled retires that reader', async () => {
    const ac = new AbortController()
    const reading = Promise.withResolvers<void>()
    const cancelled = vi.fn()
    const fetcher = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>(
            {
              pull() {
                reading.resolve()
              },
              cancel: cancelled,
            },
            { highWaterMark: 0 },
          ),
        ),
    )
    const pending = nativeSearch({ ...codex(fetcher), signal: ac.signal })
    await reading.promise
    expect(cancelled).not.toHaveBeenCalled()
    ac.abort()
    await expect(pending).rejects.toThrow(/cancelled/)
    expect(cancelled).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  test('missing-MIME SSE retains terminal, identity and DONE ordering checks', async () => {
    for (const body of [
      terminal().trimEnd(),
      terminal() + terminal(),
      `data: [DONE]\n\n${terminal()}`,
      `${terminal()}data: [DONE]\n\ndata: [DONE]\n\n`,
      terminal() + event({ type: 'response.output_text.delta', delta: 'late' }),
      event({ type: 'response.created', response: { id: 'resp_other' } }) + terminal(),
      event({ type: 'response.failed', response: { id: 'resp_123' } }) + terminal(),
      event({ type: 'response.done', response: { ...evidence(), status: 'incomplete' } }),
    ])
      await expect(nativeSearch(codex(async () => upstream(body)))).rejects.toThrow()
  })
  test('missing-MIME parsed responses still require model, execution, domain and capability evidence', async () => {
    const noSearch = evidence()
    noSearch.output = noSearch.output.filter((item) => item.type !== 'web_search_call')
    const wrongDomain = evidence()
    requireValue(textPart(wrongDomain).annotations[0]).url = 'https://example.com/'
    for (const value of [
      noSearch,
      wrongDomain,
      { ...evidence(), model: 'other' },
      { ...evidence(), status: 'incomplete' },
      { ...evidence(), output: [...evidence().output, { type: 'function_call' }] },
    ])
      await expect(nativeSearch(codex(async () => upstream(terminal(value))))).rejects.toThrow()
  })
  test('missing-MIME raw and escaped secrets are refused without disclosure', async () => {
    for (const escaped of [false, true]) {
      const value = evidence()
      textPart(value).text += KEY
      let body = terminal(value)
      if (escaped)
        body = body.replace(
          KEY,
          [...KEY].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join(''),
        )
      const error = await nativeSearch(codex(async () => upstream(body))).catch(
        (error: unknown) => error,
      )
      expect((error as NativeSearchError).diagnostic?.phase).toBe('disclosure')
      expect((error as Error).message).toContain('protected credential')
      expect((error as Error).message).not.toContain(KEY)
    }
  })
  test('missing-MIME stream retains byte, UTF-8, deadline and cancellation limits', async () => {
    await expect(
      nativeSearch(codex(async () => upstream('x'.repeat(SEARCH_RESPONSE_BYTES + 1)))),
    ).rejects.toThrow(/budget/)
    await expect(
      nativeSearch(codex(async () => new Response(new Uint8Array([0xff])))),
    ).rejects.toThrow(/invalid_utf8/)
    const ac = new AbortController()
    const pending = nativeSearch({
      ...codex(async () => new Response(new ReadableStream({ start() {} }))),
      signal: ac.signal,
    })
    ac.abort()
    await expect(pending).rejects.toThrow(/cancelled/)
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    await expect(
      nativeSearch(
        codex(async () => {
          now = 31_000
          return upstream(terminal())
        }),
      ),
    ).rejects.toThrow(/deadline/)
  })
  test('Codex alias refuses duplicate or mixed terminals in either order for both MIME forms', async () => {
    for (const media of [undefined, 'text/event-stream']) {
      for (const first of ['response.done', 'response.completed']) {
        for (const second of ['response.done', 'response.completed']) {
          const fetcher = vi.fn(async () =>
            upstream(terminal(evidence(), first) + terminal(evidence(), second), media),
          )
          await expect(nativeSearch(codex(fetcher))).rejects.toThrow(
            /duplicate provider completion/,
          )
          expect(fetcher).toHaveBeenCalledTimes(1)
        }
      }
    }
  })
  test('Codex alias retains whole-stream framing, labels, identity and sentinel order', async () => {
    const done = terminal(evidence(), 'response.done')
    for (const media of [undefined, 'text/event-stream']) {
      for (const body of [
        done.trimEnd(),
        `event: response.completed\n${done}`,
        event({ type: 'response.created', response: { id: 'resp_other' } }) + done,
        done + event({ type: 'response.failed', response: { id: 'resp_123' } }),
        done + event({ type: 'error', message: 'private provider error' }),
        done + event({ type: 'response.incomplete', response: { id: 'resp_123' } }),
        done + event({ type: 'response.cancelled', response: { id: 'resp_123' } }),
        done + event({ type: 'response.output_text.delta', delta: 'late' }),
        `${done}data: [DONE]\n\n${event({ type: 'response.created', response: { id: 'resp_123' } })}`,
        `data: [DONE]\n\n${done}`,
        `${done}data: [DONE]\n\ndata: [DONE]\n\n`,
        `${done}private trailing prose\n\n`,
      ]) {
        const fetcher = vi.fn(async () => upstream(body, media))
        await expect(nativeSearch(codex(fetcher))).rejects.toThrow()
        expect(fetcher).toHaveBeenCalledTimes(1)
      }
      await expect(
        nativeSearch(codex(async () => upstream(`${done}data: [DONE]\n\n`, media))),
      ).resolves.toHaveProperty('kind', 'grounded_answer')
    }
  })
  test('terminal alias is Codex SSE only, not an API-key alias or a JSON-envelope fallback', async () => {
    const done = terminal(evidence(), 'response.done')
    for (const body of [done, done + terminal(), terminal() + done]) {
      await expect(
        nativeSearch(opts(async () => upstream(body, 'text/event-stream'))),
      ).rejects.toThrow(/unadmitted provider terminal/)
    }
    await expect(nativeSearch(codex(async () => upstream(done, 'text/plain')))).rejects.toThrow(
      /unsupported subscription response media/,
    )
    await expect(
      nativeSearch(
        codex(async () =>
          upstream(
            JSON.stringify({ type: 'response.done', response: evidence() }),
            'application/json',
          ),
        ),
      ),
    ).rejects.toThrow()
    await expect(
      nativeSearch(codex(async () => upstream(terminal(evidence(), 'response.incomplete')))),
    ).rejects.toThrow(/failed or incomplete/)
  })
  test('Codex alias never relaxes model, search, citation or protected-content validation', async () => {
    // Independently of SDK behavior, both MIME paths require explicit completed status.
    for (const media of [undefined, 'text/event-stream']) {
      for (const status of [
        undefined,
        null,
        '',
        'unknown',
        'queued',
        'in_progress',
        'failed',
        'cancelled',
        'incomplete',
      ]) {
        const fetcher = vi.fn(async () =>
          upstream(terminal({ ...evidence(), status }, 'response.done'), media),
        )
        await expect(nativeSearch(codex(fetcher))).rejects.toThrow(
          /incomplete, failed or model identity mismatched/,
        )
        expect(fetcher).toHaveBeenCalledTimes(1)
      }
    }
    const noSearch = evidence()
    noSearch.output = noSearch.output.filter((item) => item.type !== 'web_search_call')
    const wrongDomain = evidence()
    requireValue(textPart(wrongDomain).annotations[0]).url = 'https://example.com/'
    const noCitations = evidence()
    textPart(noCitations).annotations = []
    for (const value of [
      noSearch,
      wrongDomain,
      noCitations,
      { ...evidence(), model: 'other' },
      { ...evidence(), error: { code: 'fixture_error' } },
      { ...evidence(), output: [...evidence().output, { type: 'function_call' }] },
    ])
      await expect(
        nativeSearch(codex(async () => upstream(terminal(value, 'response.done')))),
      ).rejects.toThrow()
    for (const escaped of [false, true]) {
      const value = evidence()
      textPart(value).text += KEY
      let body = terminal(value, 'response.done')
      if (escaped)
        body = body.replace(
          KEY,
          [...KEY].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join(''),
        )
      const error = await nativeSearch(codex(async () => upstream(body))).catch(
        (error: unknown) => error,
      )
      expect((error as NativeSearchError).diagnostic?.phase).toBe('disclosure')
      expect((error as Error).message).not.toContain(KEY)
    }
  })
  test('Codex alias cannot escape byte limits, cancellation or deadline by arriving early', async () => {
    const done = terminal(evidence(), 'response.done')
    await expect(
      nativeSearch(codex(async () => upstream(`${done}:${'x'.repeat(SEARCH_RESPONSE_BYTES)}\n\n`))),
    ).rejects.toThrow(/budget/)
    const huge = evidence()
    textPart(huge).text = 'x'.repeat(32 * 1024)
    await expect(
      nativeSearch(codex(async () => upstream(terminal(huge, 'response.done')))),
    ).rejects.toThrow(/budget/)
    const ac = new AbortController()
    const stalled = Promise.withResolvers<void>()
    const cancel = vi.fn()
    let sent = false
    const pending = nativeSearch({
      ...codex(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>(
              {
                pull(controller) {
                  if (!sent) {
                    sent = true
                    controller.enqueue(new TextEncoder().encode(done))
                  } else stalled.resolve()
                },
                cancel,
              },
              { highWaterMark: 0 },
            ),
          ),
      ),
      signal: ac.signal,
    })
    await stalled.promise
    ac.abort()
    await expect(pending).rejects.toThrow(/cancelled/)
    expect(cancel).toHaveBeenCalledTimes(1)
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    await expect(
      nativeSearch(
        codex(async () => {
          now = 31_000
          return upstream(done)
        }),
      ),
    ).rejects.toThrow(/deadline/)
  })
  test('turn-bound subscription host preserves receipts and refuses admission drift without fallback', async () => {
    for (const type of ['response.completed', 'response.done'])
      for (const drift of [false, true]) {
        let active = true
        const fetcher = vi.fn(async () => {
          if (drift) active = false
          return upstream(terminal(evidence(), type))
        })
        const search = host({}, fetcher, {
          model: `openai-codex:${MODEL}`,
          assertActive: () => {
            if (!active) throw new Error('private turn ended')
          },
        })
        const result = search.search({ query: 'Artemis II', allowedDomains: ['nasa.gov'] })
        if (drift) await expect(result).rejects.not.toThrow('private turn ended')
        else
          await expect(result).resolves.toMatchObject({
            backend: 'openai-codex',
            evidence: { searchCallIds: ['ws_123'] },
          })
        expect(fetcher).toHaveBeenCalledTimes(1)
      }
  })
})

describe('native search failure diagnostics without provider disclosure', () => {
  test.each([
    ['UND_ERR_CONNECT_TIMEOUT', 'connect_timeout'],
    ['UND_ERR_HEADERS_TIMEOUT', 'headers_timeout'],
    ['ENOTFOUND', 'dns_failure'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls_failure'],
    ['ECONNREFUSED', 'connection_refused'],
  ])('classifies request failure %s without disclosing the exception', async (code, expected) => {
    const fetcher = vi.fn(async () => {
      throw new TypeError(`private URL and ${KEY}`, {
        cause: Object.assign(new Error(`private hostname and ${KEY}`), { code }),
      })
    })
    const error = await nativeSearch(opts(fetcher)).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(NativeSearchError)
    expect((error as NativeSearchError).diagnostic).toEqual({
      phase: 'request',
      code: expected,
      httpStatus: null,
      mediaType: 'unknown',
      bodyFormat: 'unknown',
    })
    expect((error as Error).message).toContain(`phase=request; code=${expected}`)
    expect((error as Error).message).not.toMatch(/private|selected-api-secret/)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  test('distinguishes response-body interruption from request failure', async () => {
    const fetcher = vi.fn(async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.error(Object.assign(new Error(KEY), { code: 'ECONNRESET' }))
        },
      })
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
    })
    const error = await nativeSearch(opts(fetcher)).catch((error: unknown) => error)
    expect((error as NativeSearchError).diagnostic).toEqual({
      phase: 'body',
      code: 'connection_reset',
      httpStatus: 200,
      mediaType: 'sse',
      bodyFormat: 'unknown',
    })
    expect((error as Error).message).not.toContain(KEY)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  test('malformed JSON and 200 HTML have decode diagnostics, not entitlement assertions', async () => {
    for (const [type, media] of [
      ['application/json', 'json'],
      ['text/html', 'html'],
    ]) {
      const fetcher = vi.fn(
        async () =>
          new Response(`not JSON: ${KEY}`, {
            headers: { 'content-type': type ?? '' },
          }),
      )
      const error = await nativeSearch(opts(fetcher)).catch((error: unknown) => error)
      // Body secret filtering precedes parsing, so secret material still refuses first.
      expect((error as NativeSearchError).diagnostic?.phase).toBe('disclosure')
      expect((error as NativeSearchError).diagnostic?.bodyFormat).toBe('unknown')
      expect((error as Error).message).not.toContain(KEY)
      const malformed = vi.fn(
        async () =>
          new Response('not JSON: private upstream body', {
            headers: { 'content-type': type ?? '' },
          }),
      )
      const decoded = await nativeSearch(opts(malformed)).catch((error: unknown) => error)
      expect((decoded as NativeSearchError).diagnostic).toEqual({
        phase: 'decode',
        code: 'invalid_json',
        httpStatus: 200,
        mediaType: media,
        bodyFormat: 'other',
      })
      expect((decoded as Error).message).not.toContain('private upstream body')
      expect((decoded as Error).message).not.toMatch(/entitlement|not connected/)
      expect(malformed).toHaveBeenCalledTimes(1)
    }
  })
  test('mixed-case SSE media type uses the same strict evidence and framing checks', async () => {
    const terminal = `data: ${JSON.stringify({ type: 'response.completed', response: evidence() })}\n\n`
    const sse = (body: string) =>
      opts(
        async () =>
          new Response(body, {
            headers: { 'content-type': 'Text/Event-Stream; charset=UTF-8' },
          }),
      )
    await expect(nativeSearch(sse(terminal))).resolves.toHaveProperty('kind', 'grounded_answer')
    await expect(nativeSearch(sse(terminal.trimEnd()))).rejects.toThrow(/unterminated/)
    await expect(nativeSearch(sse(terminal + terminal))).rejects.toThrow(/duplicate/)
    await expect(nativeSearch(sse('data: not JSON\n\n'))).rejects.toThrow(/code=invalid_json/)
  })
  test('unrecognized and accessor/cyclic exception metadata stays private and bounded', async () => {
    const cyclic = new Error(KEY)
    Object.defineProperty(cyclic, 'cause', { value: cyclic })
    Object.defineProperty(cyclic, 'code', {
      get() {
        throw new Error(KEY)
      },
    })
    const unknown = Object.assign(new Error(KEY), { code: KEY })
    const prototype = Object.assign(new Error(KEY), { code: '__proto__' })
    for (const foreign of [cyclic, unknown, prototype]) {
      const fetcher = vi.fn(async () => {
        throw foreign
      })
      const error = await nativeSearch(opts(fetcher)).catch((error: unknown) => error)
      expect((error as NativeSearchError).diagnostic?.code).toBe('unknown_exception')
      expect((error as Error).message).not.toContain(KEY)
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
  })
  test('credentials, HTTP, failed terminal evidence and invalid UTF-8 have distinct safe phases', async () => {
    const credentials = await nativeSearch({
      ...opts(fake()),
      credential: async () => {
        throw new Error(KEY)
      },
    }).catch((error: unknown) => error)
    expect((credentials as NativeSearchError).diagnostic?.phase).toBe('credential')
    const http = await nativeSearch(opts(async () => new Response(KEY, { status: 403 }))).catch(
      (error: unknown) => error,
    )
    expect((http as NativeSearchError).diagnostic).toEqual({
      phase: 'request',
      code: 'refused',
      httpStatus: 403,
      mediaType: 'text',
      bodyFormat: 'unknown',
    })
    const invalid = await nativeSearch(
      opts(async () => new Response(new Uint8Array([0xff]))),
    ).catch((error: unknown) => error)
    expect((invalid as NativeSearchError).diagnostic?.phase).toBe('body')
    expect((invalid as NativeSearchError).diagnostic?.code).toBe('invalid_utf8')
    const terminal = await nativeSearch(opts(fake({ ...evidence(), status: 'failed' }))).catch(
      (error: unknown) => error,
    )
    expect((terminal as NativeSearchError).diagnostic?.phase).toBe('evidence')
    for (const error of [credentials, http, invalid, terminal])
      expect((error as Error).message).not.toContain(KEY)
  })
})

describe('review regression bounds/account/protocol', () => {
  test('decoded escaped secret leaves never disclose from native or managed results', async () => {
    const secret = 'synthetic-password-with-"quote'
    const value = evidence()
    textPart(value).text += secret
    await expect(nativeSearch({ ...opts(fake(value)), secrets: () => [secret] })).rejects.toThrow(
      /credential/,
    )
    const managed = host({ BRAVE_API_KEY: KEY, ANTHROPIC_API_KEY: secret }, async () =>
      Response.json({
        web: { results: [{ title: secret, url: 'https://nasa.gov', description: '' }] },
      }),
    )
    await expect(managed.search({ query: 'NASA' })).rejects.toThrow(/credential/)
  })
  test('API key replacement or subscription account replacement refuses before search', async () => {
    const env = { OPENAI_API_KEY: KEY }
    const fetcher = fake()
    const h = host(env, fetcher)
    env.OPENAI_API_KEY = 'other-account-api-key'
    await expect(h.search({ query: 'NASA' })).rejects.toThrow(/changed/)
    let account = 'account_123'
    const c = host({}, fetcher, { model: `openai-codex:${MODEL}`, codexAccountId: () => account })
    account = 'other_account'
    await expect(c.search({ query: 'NASA' })).rejects.toThrow(/changed/)
    expect(fetcher).not.toHaveBeenCalled()
  })
  test('subscription refresh can change access bytes only within admitted account', async () => {
    const fetcher = fake()
    const wrong = TOKEN.replace(
      TOKEN.split('.')[1] ?? '',
      Buffer.from(
        JSON.stringify({
          'https://api.openai.com/auth': { chatgpt_account_id: 'different_account' },
        }),
      ).toString('base64url'),
    )
    await expect(
      nativeSearch({
        ...opts(fetcher),
        provider: 'openai-codex',
        accountId: 'account_123',
        credential: async () => wrong,
      }),
    ).rejects.toThrow(/account changed/)
    expect(fetcher).not.toHaveBeenCalled()
    await expect(
      nativeSearch({
        ...opts(fetcher),
        provider: 'openai-codex',
        accountId: 'account_123',
        credential: async () => TOKEN,
      }),
    ).resolves.toHaveProperty('kind', 'grounded_answer')
  })
  test('SSE response identity, complete framing and DONE ordering cannot be faked', async () => {
    const terminal = `data: ${JSON.stringify({ type: 'response.completed', response: evidence() })}\n\n`
    const created = `data: ${JSON.stringify({ type: 'response.created', response: { id: 'resp_other' } })}\n\n`
    for (const body of [created + terminal, terminal.trimEnd(), `data: [DONE]\n\n${terminal}`])
      await expect(
        nativeSearch(
          opts(
            async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
          ),
        ),
      ).rejects.toThrow()
  })
  test('Unicode managed result bytes and normalized native citation bytes enforce bounds', async () => {
    const large = host({ BRAVE_API_KEY: KEY }, async () =>
      Response.json({
        web: {
          results: Array.from({ length: 8 }, () => ({
            title: '🙂'.repeat(200),
            url: 'https://example.com/' + '🙂'.repeat(1800),
            description: '🙂'.repeat(300),
          })),
        },
      }),
    )
    await expect(large.search({ query: 'NASA', count: 8 })).rejects.toThrow(/budget/)
    const value = evidence()
    requireValue(textPart(value).annotations[0]).url = 'https://nasa.gov/' + 'é'.repeat(900)
    await expect(nativeSearch(opts(fake(value)))).rejects.toThrow(/normalized citation/)
  })
})

describe('ordinary turn binding, drift, no fallback and managed parity', () => {
  test('native config drift and ended turn refuse late result', async () => {
    const env: NodeJS.ProcessEnv = { OPENAI_API_KEY: KEY }
    const fetcher = vi.fn(async () => {
      env.BRAVE_API_KEY = 'new-route-secret'
      return response()
    })
    await expect(host(env, fetcher).search({ query: 'Artemis II' })).rejects.toThrow(
      /unavailable|changed/,
    )
    let active = true
    const h = host(
      { OPENAI_API_KEY: KEY },
      async () => {
        active = false
        return response()
      },
      {
        assertActive: () => {
          if (!active) throw new Error('turn ended secret')
        },
      },
    )
    await expect(h.search({ query: 'Artemis II' })).rejects.not.toThrow(/secret/)
  })
  test('managed Brave/SearXNG keep results, explicit restriction refuses; no native fallback', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        web: { results: [{ title: 'NASA', url: 'https://nasa.gov', description: 'official' }] },
      }),
    )
    const h = host({ BRAVE_API_KEY: KEY, OPENAI_API_KEY: KEY }, fetcher)
    expect(await h.search({ query: 'NASA' })).toMatchObject({
      backend: 'brave',
      results: [{ title: 'NASA' }],
    })
    await expect(h.search({ query: 'NASA', allowedDomains: ['nasa.gov'] })).rejects.toThrow(
      /cannot enforce/,
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
    const broken = vi.fn(async () => new Response(KEY, { status: 503 }))
    await expect(
      host({ BRAVE_API_KEY: KEY, OPENAI_API_KEY: KEY }, broken).search({ query: 'NASA' }),
    ).rejects.toThrow(/503/)
    expect(broken).toHaveBeenCalledTimes(1)
  })
  test('status object cannot mutate captured route; unavailable does not contact provider', async () => {
    const h = host({ OPENAI_API_KEY: KEY })
    h.status.route = 'brave'
    expect((await h.search({ query: 'NASA' })).backend).toBe('openai')
    const fetcher = fake()
    await expect(host({}, fetcher).search({ query: 'NASA' })).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
  test('foreign backend errors cannot spoof safe host prefix', async () => {
    const h = host({ BRAVE_API_KEY: KEY }, async () => {
      throw new Error(`web_search: ${KEY}`)
    })
    await expect(h.search({ query: 'NASA' })).rejects.not.toThrow(KEY)
  })
})
