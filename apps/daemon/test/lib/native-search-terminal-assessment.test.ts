import { stream } from '@earendil-works/pi-ai/api/openai-codex-responses'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { describe, expect, test, vi } from 'vitest'
import { nativeSearch } from '../../src/lib/native-search.ts'

const MODEL = 'gpt-6.1-sol'
const TOKEN = `header.${Buffer.from(
  JSON.stringify({
    'https://api.openai.com/auth': { chatgpt_account_id: 'offline_terminal_account' },
  }),
).toString('base64url')}.signature`
function evidence(): Record<string, unknown> {
  return {
    id: 'resp_terminal_fixture',
    model: MODEL,
    status: 'completed',
    output: [
      {
        type: 'web_search_call',
        id: 'ws_terminal_fixture',
        status: 'completed',
        action: { type: 'search' },
      },
      {
        type: 'message',
        id: 'msg_terminal_fixture',
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
      },
    ],
  }
}
function wire(type: string, response: unknown) {
  return `event: ${type}\ndata: ${JSON.stringify({ type, response })}\n\n`
}
function transport(body: string, mime?: string) {
  return vi.fn(
    async () =>
      new Response(new TextEncoder().encode(body), {
        headers: mime === undefined ? {} : { 'content-type': mime },
      }),
  )
}
async function sdk(body: string, mime?: string) {
  const model = getBuiltinModels('openai-codex').find((model) => model.id === MODEL)
  if (model?.api !== 'openai-codex-responses') throw new Error('Missing pinned fixture model')
  const fetcher = transport(body, mime)
  const result = await stream(
    { ...model, api: 'openai-codex-responses' },
    normalizeContext({
      messages: [{ role: 'user', content: 'OFFLINE terminal assessment', timestamp: 0 }],
    }),
    {
      apiKey: TOKEN,
      fetch: fetcher,
      transport: 'sse',
      maxRetries: 0,
      signal: AbortSignal.timeout(5000),
    },
  ).result()
  expect(fetcher).toHaveBeenCalledTimes(1)
  return result
}
function native(body: string, mime?: string) {
  const fetcher = transport(body, mime)
  const result = nativeSearch({
    provider: 'openai-codex',
    model: MODEL,
    mode: 'cached',
    args: { query: 'OFFLINE terminal assessment', allowedDomains: ['nasa.gov'] },
    credential: async () => TOKEN,
    accountId: 'offline_terminal_account',
    secrets: () => [TOKEN],
    signal: AbortSignal.timeout(5000),
    assertActive: () => {},
    fetchImpl: fetcher,
  })
  return { result, fetcher }
}

describe('offline pinned Codex terminal compatibility assessment', () => {
  test('actual pinned SDK and native accept both Codex terminal names with strict completed evidence', async () => {
    for (const mime of [undefined, '', '   ', 'text/event-stream']) {
      for (const type of ['response.completed', 'response.done']) {
        const body = wire(type, evidence())
        expect((await sdk(body, mime)).stopReason).toBe('stop')
        const { result, fetcher } = native(body, mime)
        await expect(result).resolves.toMatchObject({
          evidence: {
            responseId: 'resp_terminal_fixture',
            searchCallIds: ['ws_terminal_fixture'],
          },
        })
        expect(fetcher).toHaveBeenCalledTimes(1)
      }
    }
  })
  test('SDK terminal normalization and early return must not replace native whole-stream checks', async () => {
    const good = evidence()
    const failed = { ...good, status: 'failed' }
    // Pi ends consumption at the first mapped terminal; native validates the bounded stream.
    const sdkBody = wire('response.done', good) + wire('response.failed', failed)
    expect((await sdk(sdkBody)).stopReason).toBe('stop')
    await expect(native(sdkBody).result).rejects.toThrow(/failed or incomplete/)
    expect((await sdk(wire('response.incomplete', good))).stopReason).toBe('stop')
    await expect(native(wire('response.incomplete', good)).result).rejects.toThrow(
      /failed or incomplete/,
    )
  })
  test('SDK stop is not strict search success for missing, unknown, queued or in-progress status', async () => {
    for (const status of [undefined, 'unrecognized_fixture', 'queued', 'in_progress']) {
      const value = { ...evidence(), status }
      expect((await sdk(wire('response.done', value))).stopReason).toBe('stop')
      // The production alias must not synthesize completed status from SDK stop.
      const { result, fetcher } = native(wire('response.done', value))
      await expect(result).rejects.toThrow(/incomplete, failed or model identity mismatched/)
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
  })
  test('failed and incomplete SDK terminals cannot become native search success by a name-only alias', async () => {
    for (const [status, details, expected] of [
      ['failed', undefined, 'error'],
      ['cancelled', undefined, 'error'],
      ['incomplete', undefined, 'error'],
      ['incomplete', { reason: 'max_output_tokens' }, 'length'],
    ] as const) {
      const value = { ...evidence(), status, incomplete_details: details }
      expect((await sdk(wire('response.done', value))).stopReason).toBe(expected)
      await expect(native(wire('response.done', value)).result).rejects.toThrow(
        /incomplete, failed or model identity mismatched/,
      )
    }
    const noSearch = { ...evidence(), output: [] }
    expect((await sdk(wire('response.done', noSearch))).stopReason).toBe('stop')
    await expect(native(wire('response.done', noSearch)).result).rejects.toThrow(
      /execution evidence/,
    )
  })
})
