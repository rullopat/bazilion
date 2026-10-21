import { describe, expect, test, vi } from 'vitest'
import {
  nativeSearch,
  SEARCH_RESPONSE_BYTES,
  SEARCH_RETURN_BYTES,
} from '../../src/lib/native-search.ts'
import { createOrdinaryWebSearchHost } from '../../src/lib/ordinary-web-search.ts'
import { ordinaryWebSearchTool } from '../../src/runtime/tools/web.ts'

const MODEL = 'gpt-6.1-sol'
const SECRET = 'synthetic-accumulator-secret'
const TOKEN = `header.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'fixture_account' } })).toString('base64url')}.signature`
const search = () => ({
  id: 'ws_fixture',
  type: 'web_search_call',
  status: 'completed',
  action: { type: 'search', queries: ['NASA'] },
})
const message = () => ({
  id: 'msg_fixture',
  type: 'message',
  role: 'assistant',
  status: 'completed',
  content: [
    {
      type: 'output_text',
      text: 'NASA fixture.',
      annotations: [
        {
          type: 'url_citation',
          url: 'https://www.nasa.gov/',
          title: 'NASA',
          start_index: 0,
          end_index: 4,
        },
      ],
    },
  ],
})
const response = (output: unknown[] = []) => ({
  id: 'resp_fixture',
  model: MODEL,
  status: 'completed',
  output,
  usage: { input_tokens: 12, output_tokens: 34, total_tokens: 46 },
})
const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`
const item = (value: unknown, index: number, type = 'done') =>
  event({ type: `response.output_item.${type}`, output_index: index, item: value })
const end = (value: unknown = response(), type = 'response.completed') =>
  event({ type, response: value })
const items = () => item(search(), 0) + item(message(), 1)
const body = () => items() + end()
const progress = (index = 0, id = 'ws_fixture') =>
  event({ type: 'response.web_search_call.completed', output_index: index, item_id: id })
function options(fetchImpl: typeof fetch) {
  return {
    provider: 'openai-codex' as const,
    model: MODEL,
    mode: 'cached' as const,
    credential: async () => TOKEN,
    accountId: 'fixture_account',
    args: { query: 'NASA', allowedDomains: ['nasa.gov'] },
    secrets: () => [SECRET],
    signal: new AbortController().signal,
    assertActive: () => {},
    fetchImpl,
  }
}
async function run(
  wire = body(),
  mime?: string,
  provider: 'openai' | 'openai-codex' = 'openai-codex',
) {
  const fetcher = vi.fn(
    async () =>
      new Response(new TextEncoder().encode(wire), {
        headers: mime === undefined ? {} : { 'content-type': mime },
      }),
  )
  try {
    return await nativeSearch({ ...options(fetcher), provider })
  } finally {
    expect(fetcher).toHaveBeenCalledTimes(1)
  }
}

describe('Codex completed-stream search evidence', () => {
  test('accepts actual completed search and annotated answer with empty SSE terminal and explicit provenance', async () => {
    for (const mime of [undefined, 'text/event-stream', '   '])
      for (const terminal of ['response.completed', 'response.done']) {
        const wire =
          event({ type: 'response.created', response: { id: 'resp_fixture', model: MODEL } }) +
          item({ ...search(), status: 'in_progress' }, 0, 'added') +
          progress() +
          item(search(), 0) +
          item({ ...message(), status: 'in_progress', content: [] }, 1, 'added') +
          event({
            type: 'response.output_text.delta',
            output_index: 1,
            item_id: 'msg_fixture',
            delta: 'NASA ',
          }) +
          item(message(), 1) +
          end(response(), terminal) +
          'data: [DONE]\n\n'
        expect(await run(wire, mime)).toMatchObject({
          kind: 'grounded_answer',
          model: MODEL,
          answer: 'NASA fixture.',
          citations: [{ url: 'https://www.nasa.gov/' }],
          evidence: {
            responseId: 'resp_fixture',
            searchCallIds: ['ws_fixture'],
            outputSource: 'completed_stream',
            observedMode: 'unknown',
            usage: { totalTokens: 46 },
          },
        })
      }
  })
  test('admitted content and reasoning event families bind to completed items without becoming evidence', async () => {
    const reasoning = { id: 'rs_fixture', type: 'reasoning', summary: [] }
    const contentEvents = [
      'response.content_part.added',
      'response.content_part.done',
      'response.output_text.delta',
      'response.output_text.done',
      'response.output_text.annotation.added',
      'response.refusal.delta',
      'response.refusal.done',
    ]
    const reasoningEvents = [
      'response.reasoning_summary_part.added',
      'response.reasoning_summary_part.done',
      'response.reasoning_summary_text.delta',
      'response.reasoning_summary_text.done',
      'response.reasoning_text.delta',
      'response.reasoning_text.done',
    ]
    for (const [type, index, id] of [
      ...contentEvents.map((type) => [type, 2, 'msg_fixture'] as const),
      ...reasoningEvents.map((type) => [type, 1, 'rs_fixture'] as const),
    ]) {
      const reference = event({
        type,
        output_index: index,
        item_id: id,
        delta: '',
        text: '',
        refusal: '',
        part: { type: 'summary_text', text: '' },
      })
      const wire = item(search(), 0) + reference + item(reasoning, 1) + item(message(), 2) + end()
      expect(await run(wire)).toMatchObject({ evidence: { outputSource: 'completed_stream' } })
      await expect(run(item(search(), 0) + reference + end())).rejects.toThrow(
        /incomplete or noncontiguous/,
      )
      await expect(
        run(event({ type, output_index: 0, item_id: 'ws_fixture' }) + body()),
      ).rejects.toThrow(/identity or type changed/)
    }
  })
  test('preserves populated terminal and JSON paths without widening API-key or missing-output acceptance', async () => {
    const terminal = response([search(), message()])
    for (const provider of ['openai', 'openai-codex'] as const) {
      expect(await run(items() + end(terminal), 'text/event-stream', provider)).toMatchObject({
        evidence: { outputSource: 'terminal' },
      })
      expect(await run(JSON.stringify(terminal), 'application/json', provider)).toMatchObject({
        evidence: { outputSource: 'terminal' },
      })
      await expect(run(JSON.stringify(response()), 'application/json', provider)).rejects.toThrow(
        /missing hosted search/,
      )
    }
    await expect(run(body(), 'text/event-stream', 'openai')).rejects.toThrow(/terminal output/)
    for (const output of [undefined, null, {}, ''])
      await expect(run(items() + end({ ...response(), output }))).rejects.toThrow()
    await expect(run(items() + end(response([search()])))).rejects.toThrow(/terminal output/)
  })
  test('requires complete contiguous slots and never synthesizes from progress, deltas or added items', async () => {
    for (const prefix of [
      progress(),
      item(search(), 0, 'added') + item(message(), 1),
      item(search(), 0) + item(message(), 1, 'added'),
      item(search(), 0) + item(message(), 2),
      item(search(), 1) + item(message(), 2),
      items() +
        event({
          type: 'response.output_text.delta',
          output_index: 2,
          item_id: 'msg_other',
          delta: 'unfinished',
        }),
      items() + item({ id: 'rs_fixture', type: 'reasoning', summary: [] }, 2, 'added'),
    ])
      await expect(run(prefix + end())).rejects.toThrow(/incomplete or noncontiguous/)
    await expect(run(progress() + item(message(), 1) + end())).rejects.toThrow(
      /incomplete or noncontiguous/,
    )
    await expect(run(item(search(), 0) + end())).rejects.toThrow(/no grounded answer/)
    await expect(run(item(message(), 0) + end())).rejects.toThrow(/missing hosted search/)
  })
  test('preserves terminal status model error and response identity requirements', async () => {
    for (const status of [
      undefined,
      null,
      'failed',
      'incomplete',
      'queued',
      'in_progress',
      'cancelled',
      'unknown',
    ])
      await expect(run(items() + end({ ...response(), status }))).rejects.toThrow(
        /provider response incomplete/,
      )
    for (const change of [
      { model: undefined },
      { model: 'other-model' },
      { error: {} },
      { incomplete_details: {} },
      { id: undefined },
    ])
      await expect(run(items() + end({ ...response(), ...change }))).rejects.toThrow()
    await expect(
      run(event({ type: 'response.created', response: { id: 'resp_other' } }) + body()),
    ).rejects.toThrow(/identity changed/)
    await expect(
      run(
        items() +
          event({ type: 'response.completed', response_id: 'resp_other', response: response() }),
      ),
    ).rejects.toThrow(/identity changed/)
  })
  test('rejects duplicate completed items, reopened slots and changed or displaced identities', async () => {
    for (const prefix of [
      item(search(), 0) + items(),
      items() + item(message(), 1),
      items() + item(message(), 1, 'added'),
      item(search(), 0, 'added') + item(search(), 0, 'added') + items(),
      item(search(), 0, 'added') + item({ ...search(), id: 'ws_other' }, 0) + item(message(), 1),
      item(search(), 0) + item(search(), 1) + item(message(), 2),
      item(search(), 0) + progress(),
      items() +
        event({
          type: 'response.output_text.delta',
          output_index: 1,
          item_id: 'msg_fixture',
          delta: 'late',
        }),
    ])
      await expect(run(prefix + end())).rejects.toThrow()
  })
  test('rejects invalid execution status action and unadmitted streamed capabilities', async () => {
    for (const value of [
      { ...search(), status: 'failed' },
      { ...search(), status: undefined },
      { ...search(), action: { type: 'unknown' } },
      { ...search(), action: { type: ['search'] } },
      { ...search(), type: 'function_call' },
      { ...search(), type: 'mcp_call' },
      { ...search(), type: ['web_search_call'] },
    ])
      await expect(run(item(value, 0) + item(message(), 1) + end())).rejects.toThrow()
    for (const type of ['open_page', 'find_in_page'])
      await expect(
        run(item({ ...search(), action: { type } }, 0) + item(message(), 1) + end()),
      ).rejects.toThrow(/missing hosted search/)
    await expect(
      run(
        items() +
          event({
            type: 'response.function_call_arguments.delta',
            output_index: 2,
            item_id: 'fc_other',
            delta: '{}',
          }) +
          end(),
      ),
    ).rejects.toThrow(/unadmitted streamed output event/)
    await expect(
      run(item({ id: 'rs_fixture', type: 'reasoning', status: 'incomplete' }, 0) + end()),
    ).rejects.toThrow(/incomplete streamed reasoning/)
  })
  test('rejects changed complete terminal messages citations actions and reasoning without union', async () => {
    for (const output of [
      [
        search(),
        { ...message(), content: [{ type: 'output_text', text: 'changed', annotations: [] }] },
      ],
      [{ ...search(), action: { type: 'search', query: 'changed' } }, message()],
      [search(), { ...message(), role: 'user' }],
      [message(), search()],
    ])
      await expect(run(items() + end(response(output)))).rejects.toThrow(/disagree/)
    const reasoning = { id: 'rs_fixture', type: 'reasoning', summary: [] }
    await expect(
      run(
        items() +
          item(reasoning, 2) +
          end(response([search(), message(), { ...reasoning, summary: [{ text: 'changed' }] }])),
      ),
    ).rejects.toThrow(/disagree/)
    expect(await run(items() + item(reasoning, 2) + end())).toMatchObject({
      evidence: { outputSource: 'completed_stream' },
    })
  })
  test('requires completed annotated assistant content and enforces URL and domain rules', async () => {
    for (const change of [
      { status: 'in_progress' },
      { role: 'user' },
      { content: undefined },
      { content: [{ type: 'output_text', text: 'prose only', annotations: [] }] },
      { content: [{ type: 'output_text', text: 'prose only' }] },
      { content: [{ type: 'refusal', refusal: 'no' }] },
    ])
      await expect(
        run(item(search(), 0) + item({ ...message(), ...change }, 1) + end()),
      ).rejects.toThrow()
    for (const url of [
      'https://nasa.gov.evil.test/',
      'https://user:pass@www.nasa.gov/',
      'file:///etc/passwd',
    ]) {
      const value = message()
      const annotation = value.content[0]?.annotations[0]
      if (!annotation) throw new Error('Missing fixture annotation')
      annotation.url = url
      await expect(run(item(search(), 0) + item(value, 1) + end())).rejects.toThrow(/citation/)
    }
  })
  test('consumes the entire stream and refuses trailing failures mixed terminals and malformed framing', async () => {
    for (const tail of [
      end(),
      end(response(), 'response.done'),
      event({ type: 'error' }),
      event({ type: 'response.incomplete', response: response() }),
      item(message(), 1),
      'data: {"type":"unterminated"}',
      'unexpected prose\n\n',
      'data: [DONE]\n\n' + event({ type: 'error' }),
      'data: [DONE]\n\ndata: [DONE]\n\n',
    ])
      await expect(run(body() + tail)).rejects.toThrow()
    await expect(run(items())).rejects.toThrow(/without successful terminal/)
    await expect(run('data: [DONE]\n\n' + body())).rejects.toThrow(/out of order/)
  })
  test('keeps upstream returned-output item and execution budgets', async () => {
    await expect(run(body() + ':'.padEnd(SEARCH_RESPONSE_BYTES, 'x') + '\n\n')).rejects.toThrow(
      /byte budget/,
    )
    const huge = message()
    const part = huge.content[0]
    if (!part) throw new Error('Missing fixture part')
    part.text = 'x'.repeat(SEARCH_RETURN_BYTES)
    await expect(run(item(search(), 0) + item(huge, 1) + end())).rejects.toThrow(
      /returned evidence byte budget/,
    )
    for (const index of [-1, 128, 0.5, '0'])
      await expect(run(item(search(), index as number) + end())).rejects.toThrow(
        /identity or index/,
      )
    await expect(
      run(
        Array.from({ length: 9 }, (_, i) => item({ ...search(), id: `ws_${i}` }, i)).join('') +
          item(message(), 9) +
          end(),
      ),
    ).rejects.toThrow(/excessive hosted search/)
  })
  test('filters raw and escaped live secrets without exposing completed items in diagnostics', async () => {
    const value = message()
    const part = value.content[0]
    if (!part) throw new Error('Missing fixture part')
    part.text += SECRET
    const wire = item(search(), 0) + item(value, 1) + end()
    for (const candidate of [
      wire,
      wire.replace(
        SECRET,
        [...SECRET].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join(''),
      ),
    ]) {
      try {
        await run(candidate)
        throw new Error('Expected refusal')
      } catch (error) {
        expect(String(error)).toMatch(/protected credential/)
        expect(String(error)).not.toMatch(/synthetic-accumulator-secret|ws_fixture|NASA fixture/)
      }
    }
    const fetcher = vi.fn(async () => new Response(new TextEncoder().encode(wire)))
    let calls = 0
    await expect(
      nativeSearch({ ...options(fetcher), secrets: () => (++calls === 1 ? [] : [SECRET]) }),
    ).rejects.toThrow(/protected credential/)
  })
  test('keeps terminal diagnostic facts unchanged when projection of accumulated items refuses', async () => {
    try {
      await run(item(search(), 0) + end())
      throw new Error('Expected refusal')
    } catch (error) {
      expect(error).toMatchObject({
        diagnostic: {
          phase: 'evidence',
          evidence: {
            terminal: 'completed',
            outputItems: 0,
            terminalSearchItems: 0,
            terminalSearchActions: 0,
            streamedSearchItems: 1,
          },
        },
      })
    }
  })
  test('cancellation while awaiting EOF cannot disclose an early empty-terminal success', async () => {
    const controller = new AbortController()
    let cancelled = false
    const waiting = Promise.withResolvers<void>()
    const fetcher = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(stream) {
              stream.enqueue(new TextEncoder().encode(body()))
            },
            pull() {
              waiting.resolve()
            },
            cancel() {
              cancelled = true
            },
          }),
        ),
    )
    const pending = nativeSearch({ ...options(fetcher), signal: controller.signal })
    await waiting.promise
    controller.abort()
    await expect(pending).rejects.toThrow(/cancelled/)
    expect(cancelled).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  test('deadline remains mandatory for completed-stream evidence', async () => {
    let now = 0
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => now)
    try {
      const fetcher = vi.fn(async () => {
        now = 31_000
        return new Response(new TextEncoder().encode(body()))
      })
      await expect(nativeSearch(options(fetcher))).rejects.toThrow(/deadline/)
      expect(fetcher).toHaveBeenCalledTimes(1)
    } finally {
      spy.mockRestore()
    }
  })
  test('expired authority after response capture refuses and no host fallback or replay occurs', async () => {
    let current = true
    const fetcher = vi.fn(async () => {
      current = false
      return new Response(new TextEncoder().encode(body()))
    })
    const host = createOrdinaryWebSearchHost({
      env: () => ({}),
      model: `openai-codex:${MODEL}`,
      codexConnected: () => true,
      codexAccountId: () => 'fixture_account',
      codexCredential: async () => TOKEN,
      signal: new AbortController().signal,
      assertActive: () => {
        if (!current) throw new Error('revoked')
      },
      fetchImpl: fetcher,
    })
    await expect(host.search({ query: 'NASA', allowedDomains: ['nasa.gov'] })).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  test('turn-bound host returns completed-stream provenance through its normal search path', async () => {
    const fetcher = vi.fn(async () => new Response(new TextEncoder().encode(body())))
    const host = createOrdinaryWebSearchHost({
      env: () => ({}),
      model: `openai-codex:${MODEL}`,
      codexConnected: () => true,
      codexAccountId: () => 'fixture_account',
      codexCredential: async () => TOKEN,
      signal: new AbortController().signal,
      assertActive: () => {},
      fetchImpl: fetcher,
    })
    const output = await ordinaryWebSearchTool(host).invoke({
      query: 'NASA',
      allowedDomains: ['nasa.gov'],
    })
    expect(output).toMatchObject({ webSearch: { evidence: { outputSource: 'completed_stream' } } })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
