import { describe, expect, test, vi } from 'vitest'
import {
  NativeSearchError,
  nativeSearch,
  projectNativeSearch,
} from '../../src/lib/native-search.ts'
import { NativeSearchEvidence } from '../../src/lib/native-search-evidence.ts'
import { createOrdinaryWebSearchHost } from '../../src/lib/ordinary-web-search.ts'

const MODEL = 'gpt-6.1-sol'
const SECRET = 'synthetic-evidence-secret'
const TOKEN = `header.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'fixture_account' } })).toString('base64url')}.signature`
const search = (id = 'ws_fixture') => ({
  id,
  type: 'web_search_call',
  status: 'completed',
  action: { type: 'search', queries: ['private fixture query'] },
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
const response = (output: unknown[] = [search(), message()]) => ({
  id: 'resp_fixture',
  model: MODEL,
  status: 'completed',
  output,
})
const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`
const itemDone = (item: unknown = search(), index = 0) =>
  event({ type: 'response.output_item.done', output_index: index, item })
const terminal = (value: unknown = response(), type = 'response.done') =>
  event({ type, response: value })
const progress = (id = 'ws_fixture', index = 0) =>
  event({ type: 'response.web_search_call.completed', item_id: id, output_index: index })
const opts = (fetcher: typeof fetch) => ({
  provider: 'openai-codex' as const,
  model: MODEL,
  mode: 'cached' as const,
  credential: async () => TOKEN,
  accountId: 'fixture_account',
  args: { query: 'NASA', allowedDomains: ['nasa.gov'] },
  secrets: () => [SECRET],
  assertActive: () => {},
  signal: new AbortController().signal,
  fetchImpl: fetcher,
})
async function run(body: string, mime?: string) {
  const fetcher = vi.fn(
    async () =>
      new Response(new TextEncoder().encode(body), {
        headers: mime === undefined ? {} : { 'content-type': mime },
      }),
  )
  const value = await nativeSearch(opts(fetcher)).catch((error: unknown) => error)
  expect(fetcher).toHaveBeenCalledTimes(1)
  return value
}
function failure(value: unknown, reason: RegExp) {
  expect(value).toBeInstanceOf(NativeSearchError)
  expect((value as Error).message).toMatch(reason)
  return value as NativeSearchError
}

describe('native search evidence contract and private structural diagnostics', () => {
  test('terminal search IDs distinguish missing, duplicate and excessive without exposing values', async () => {
    const projection = {
      provider: 'openai-codex' as const,
      model: MODEL,
      mode: 'cached' as const,
      count: 6,
    }
    for (const [items, reason] of [
      [[message()], /missing hosted search execution evidence/],
      [[search(), search(), message()], /duplicate hosted search execution evidence/],
      [
        [...Array.from({ length: 9 }, (_, i) => search(`ws_${i}`)), message()],
        /excessive hosted search execution evidence/,
      ],
    ] as const) {
      expect(() => projectNativeSearch(response([...items]), projection)).toThrow(reason)
      const error = failure(await run(terminal(response([...items]))), reason)
      expect(error.diagnostic?.evidence?.terminalSearchActions).toBe(items.length - 1)
      expect(error.message).not.toMatch(/private fixture query|ws_fixture|msg_fixture|https:/)
    }
  })
  test('valid terminal and streamed evidence agree without adding or duplicating receipts', async () => {
    for (const mime of [undefined, 'text/event-stream'])
      for (const type of ['response.completed', 'response.done']) {
        const body =
          event({ type: 'response.created', response: { id: 'resp_fixture' } }) +
          progress() +
          itemDone() +
          terminal(response(), type)
        expect(await run(body, mime)).toMatchObject({
          kind: 'grounded_answer',
          evidence: { searchCallIds: ['ws_fixture'] },
        })
      }
    expect(await run(terminal())).toMatchObject({ evidence: { searchCallIds: ['ws_fixture'] } })
    expect(await run(JSON.stringify(response()), 'application/json')).toMatchObject({
      kind: 'grounded_answer',
    })
  })
  test('streamed items and lifecycle markers cannot repair nonempty terminal omissions', async () => {
    for (const prefix of [itemDone(), progress(), progress() + itemDone()]) {
      const error = failure(await run(prefix + terminal(response([message()]))), /terminal output/)
      expect(error.diagnostic?.evidence).toMatchObject({
        terminal: 'done',
        terminalSearchItems: 0,
        terminalSearchActions: 0,
      })
      expect(error.message).not.toMatch(/private fixture query|ws_fixture|resp_fixture/)
    }
    const open = { ...search(), action: { type: 'open_page' } }
    const error = failure(await run(terminal(response([open, message()]))), /missing hosted search/)
    expect(error.diagnostic?.evidence).toMatchObject({
      terminalSearchItems: 1,
      terminalSearchActions: 0,
      terminalOtherWebActions: 1,
    })
  })
  test('contradictory streamed status, action, index, identity and capabilities refuse', async () => {
    for (const body of [
      itemDone({ ...search(), status: 'failed' }) + terminal(),
      itemDone({ ...search(), status: 'incomplete' }) + terminal(),
      itemDone({ ...search(), action: { type: 'open_page' } }) + terminal(),
      itemDone({ ...search(), action: { type: 'search', queries: ['other query'] } }) + terminal(),
      itemDone(search(), 1) + terminal(),
      itemDone(search('ws_other')) + terminal(),
      itemDone() + itemDone() + terminal(),
      itemDone() + itemDone(search(), 1) + terminal(),
      progress('ws_other') + terminal(),
      progress() + progress('ws_other') + terminal(),
      event({
        type: 'response.output_item.done',
        output_index: 0,
        item: { type: 'function_call', id: 'fc_fixture' },
      }) + terminal(),
      event({
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'mcp_call', id: 'mcp_fixture' },
      }) + terminal(),
    ])
      failure(await run(body), /streamed|terminal output/)
  })
  test('review regressions reject coerced types and added-item identity contradictions', async () => {
    for (const item of [
      { ...search(), type: ['web_search_call'], status: 'failed' },
      { ...search(), action: { type: ['search'] } },
    ])
      failure(await run(itemDone(item) + terminal()), /unadmitted streamed|unknown streamed/)
    failure(
      await run(
        terminal(
          response([
            { ...search(), action: { type: ['open_page'] } },
            search('ws_second'),
            message(),
          ]),
        ),
      ),
      /unknown hosted action/,
    )
    for (const type of [undefined, null, ['response.output_item.done'], 1])
      failure(
        await run(event({ type, output_index: 0, item: search() }) + terminal()),
        /invalid provider event type/,
      )
    for (const item of [
      { ...search('ws_other'), status: 'in_progress' },
      { ...message(), id: 'ws_fixture' },
    ]) {
      const added = event({ type: 'response.output_item.added', output_index: 0, item })
      failure(await run(added + terminal()), /streamed output identity or type/)
      failure(await run(added + itemDone() + terminal()), /streamed output identity or type/)
    }
    const added = event({
      type: 'response.output_item.added',
      output_index: 0,
      item: { ...search(), status: 'in_progress', action: { type: 'search' } },
    })
    expect(await run(added + itemDone() + terminal())).toMatchObject({ kind: 'grounded_answer' })
  })
  test('top-level response identity cannot contradict nested identity in one event', async () => {
    for (const type of ['response.created', 'response.done', 'response.completed']) {
      const body =
        event({ type, response_id: 'resp_other', response: response() }) +
        (type === 'response.created' ? terminal() : '')
      failure(await run(body), /response identity changed/)
    }
    expect(
      await run(
        event({ type: 'response.done', response_id: 'resp_fixture', response: response() }),
      ),
    ).toMatchObject({ kind: 'grounded_answer' })
  })
  test('diagnostic counters are bounded and never contain provider-controlled strings', async () => {
    const many = response(Array.from({ length: 200 }, () => search('private_id')))
    const error = failure(await run(terminal(many)), /excessive output/)
    expect(error.diagnostic?.evidence).toMatchObject({
      outputItems: 129,
      terminalSearchItems: 129,
      terminalSearchActions: 129,
    })
    expect(error.message).not.toMatch(/private_id|private fixture query/)
    const inventory = new NativeSearchEvidence((message) => {
      throw new Error(message)
    })
    for (let i = 0; i < 500; i++)
      inventory.observe({
        type: 'response.web_search_call.searching',
        item_id: 'ws_fixture',
        output_index: 0,
      })
    expect(inventory.facts.searchProgressEvents).toBe(129)
    expect(JSON.stringify(inventory.facts)).not.toContain('ws_fixture')
    for (const index of [-1, 128, 1.5, '0', null]) {
      failure(
        await run(
          event({ type: 'response.output_item.done', item: search(), output_index: index }) +
            terminal(),
        ),
        /identity or index/,
      )
    }
  })
  test('raw secret filtering precedes structural observation and decoded evidence still cannot disclose secrets', async () => {
    const raw = failure(
      await run(itemDone({ ...search(), action: { type: 'search', query: SECRET } }) + terminal()),
      /protected credential/,
    )
    expect(raw.diagnostic?.evidence).toBeUndefined()
    expect(raw.message).not.toContain(SECRET)
    const secretMessage = message()
    const part = secretMessage.content[0]
    if (!part) throw new Error('Missing fixture message')
    part.text += SECRET
    const body = terminal(response([search(), secretMessage])).replace(
      SECRET,
      [...SECRET].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join(''),
    )
    const escaped = failure(await run(body), /protected credential/)
    expect(escaped.message).not.toContain(SECRET)
    expect(JSON.stringify(escaped.diagnostic)).not.toMatch(
      /ws_fixture|private fixture query|https:/,
    )
  })
  test('turn-bound host refuses stream contradictions without replay or fallback', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          new TextEncoder().encode(itemDone({ ...search(), status: 'failed' }) + terminal()),
        ),
    )
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
    await expect(host.search({ query: 'NASA', allowedDomains: ['nasa.gov'] })).rejects.toThrow(
      /streamed hosted search did not complete/,
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
