import { expect, test, vi } from 'vitest'
import { generateOpenAIImages, ImageProtocolFailure } from '../../src/lib/image-transport.ts'

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhK0AAAAASUVORK5CYII='
const item = { type: 'image_generation_call', id: 'ig_fixture', status: 'completed', result: png }
const complete = {
  type: 'response.completed',
  response: { id: 'resp_fixture', status: 'completed', output: [item] },
}
const wire = (events: unknown[]) =>
  events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')
const call = (fetcher: typeof fetch, provider: 'openai' | 'openai-codex' = 'openai-codex') =>
  generateOpenAIImages({
    provider,
    apiKey: 'never-retain-credential',
    prompt: 'Fixture bird',
    signal: new AbortController().signal,
    fetch: fetcher,
  })
const reply = (body: string | Uint8Array, mime?: string) =>
  new Response(typeof body === 'string' ? new TextEncoder().encode(body) : body, {
    headers: mime === undefined ? {} : { 'content-type': mime },
  })

test.each([
  undefined,
  '',
  '   ',
  'text/event-stream',
  'TEXT/EVENT-STREAM; charset=utf-8',
])('Codex explicitly streamed request decodes strict SSE with MIME %j', async (mime) => {
  const fetcher = vi.fn<typeof fetch>(async (_, init) => {
    const body = JSON.parse(String(init?.body))
    expect(body.stream).toBe(true)
    expect(new Headers(init?.headers).get('Accept')).toBe('text/event-stream')
    return reply(wire([complete]) + 'data: [DONE]\n\n', mime)
  })
  expect((await call(fetcher)).output).toEqual([
    { type: 'image', mimeType: 'image/png', data: png },
  ])
  expect(fetcher).toHaveBeenCalledTimes(1)
})

test.each([
  '\n',
  '\r\n',
  '\r',
])('strict image SSE accepts standard line ending %j', async (ending) => {
  const body = wire([complete]).replaceAll('\n', ending)
  expect((await call(async () => reply(body))).output).toHaveLength(1)
})

test.each([
  'text/html',
  'text/plain',
  'application/json',
  'text/event-stream-malicious',
  'x'.repeat(257),
])('populated unsupported Codex media %j refuses even plausible SSE', async (mime) => {
  await expect(call(async () => reply(wire([complete]), mime))).rejects.toThrow('phase=media')
})

test.each([
  ['HTML prefix', `<html>\n${wire([complete])}`],
  ['prose prefix', `not an event\n\n${wire([complete])}`],
  ['JSON body', JSON.stringify(complete)],
  ['unterminated event', wire([complete]).trimEnd()],
  ['invalid JSON', 'data: {broken}\n\n'],
  ['mismatched label', `event: response.done\n${wire([complete])}`],
  ['duplicate labels', `event: response.completed\nevent: response.completed\n${wire([complete])}`],
  ['label without data', `event: unknown\n\n${wire([complete])}`],
  [
    'nonstring type',
    wire([{ type: { toString: 'response.completed' }, response: complete.response }]),
  ],
  ['DONE before terminal', `data: [DONE]\n\n${wire([complete])}`],
  ['duplicate DONE', `${wire([complete])}data: [DONE]\n\ndata: [DONE]\n\n`],
  [
    'event after DONE',
    `${wire([complete])}data: [DONE]\n\n${wire([{ type: 'response.created' }])}`,
  ],
  ['late item', wire([complete, { type: 'response.output_item.done', item }])],
  ['late failure', wire([complete, { type: 'response.failed' }])],
  ['duplicate terminal', wire([complete, complete])],
  ['cancelled', wire([{ type: 'response.cancelled' }, complete])],
  ['response.done not enabled', wire([{ ...complete, type: 'response.done' }])],
  [
    'explicit empty not reconstructed',
    wire([
      { type: 'response.output_item.done', item },
      { ...complete, response: { ...complete.response, output: [] } },
    ]),
  ],
  [
    'failed terminal',
    wire([{ ...complete, response: { ...complete.response, status: 'failed' } }]),
  ],
  [
    'incomplete details',
    wire([{ ...complete, response: { ...complete.response, incomplete_details: {} } }]),
  ],
  ['comment frame cap', ': comment\n\n'.repeat(513) + wire([complete])],
])('missing-MIME image response refuses %s without retry', async (_, body) => {
  const fetcher = vi.fn<typeof fetch>(async () => reply(body))
  await expect(call(fetcher)).rejects.toBeInstanceOf(ImageProtocolFailure)
  expect(fetcher).toHaveBeenCalledTimes(1)
})

test('invalid UTF-8 refuses, and decoder/projection exceptions expose only closed facts', async () => {
  await expect(call(async () => reply(new Uint8Array([0xff])))).rejects.toThrow('phase=decode')
  let caught: unknown
  try {
    await call(async () => reply('data: {never-retain-credential}\n\n'))
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(ImageProtocolFailure)
  expect(String(caught)).not.toContain('never-retain-credential')
  expect(String(caught)).toContain('media=missing; terminal=unseen')
  await expect(
    call(async () => reply(wire([{ ...complete, response: { output: [] } }]))),
  ).rejects.toThrow('phase=evidence; media=missing; terminal=completed')
})

test.each([
  [
    'terminal_error',
    [
      {
        ...complete,
        response: { ...complete.response, error: { message: 'never-retain-credential' } },
      },
    ],
  ],
  [
    'terminal_incomplete',
    [
      {
        ...complete,
        response: {
          ...complete.response,
          incomplete_details: { reason: 'never-retain-credential' },
        },
      },
    ],
  ],
  [
    'terminal_status',
    [{ ...complete, response: { ...complete.response, status: 'never-retain-credential' } }],
  ],
  ['malformed_terminal', [{ ...complete, response: 'never-retain-credential' }]],
  ['duplicate_completion', [complete, complete]],
  ['done_alias_after_completion', [complete, { ...complete, type: 'response.done' }]],
  ['item_after_completion', [complete, { type: 'response.output_item.done', item }]],
  [
    'failure_after_completion',
    [complete, { type: 'response.failed', error: 'never-retain-credential' }],
  ],
  ['other_event_after_completion', [complete, { type: 'never-retain-credential' }]],
  ['malformed_output', [{ ...complete, response: { output: 'never-retain-credential' } }]],
  [
    'evidence_response',
    [
      { type: 'response.output_item.done', item, output_index: 0 },
      { ...complete, response: { output: [] } },
    ],
  ],
  [
    'no_image_items',
    [
      {
        ...complete,
        response: { output: [{ type: 'message', content: 'never-retain-credential' }] },
      },
    ],
  ],
  [
    'too_many_image_items',
    [{ ...complete, response: { output: Array.from({ length: 5 }, () => item) } }],
  ],
  [
    'malformed_output_item',
    [{ ...complete, response: { output: ['never-retain-credential', item] } }],
  ],
  ['invalid_image_identity', [{ ...complete, response: { output: [{ ...item, id: {} }] } }]],
  ['duplicate_image_identity', [{ ...complete, response: { output: [item, item] } }]],
  [
    'image_status',
    [{ ...complete, response: { output: [{ ...item, status: 'never-retain-credential' }] } }],
  ],
  [
    'missing_image_bytes',
    [
      {
        ...complete,
        response: { output: [{ ...item, result: { secret: 'never-retain-credential' } }] },
      },
    ],
  ],
  ['evidence_event', [{ type: 'response.done', response: complete.response }]],
  ['provider_failure', [{ type: 'error', message: 'never-retain-credential' }]],
  ['malformed_event', ['never-retain-credential']],
  ['invalid_event_type_or_label', [{ type: {} }]],
  ['malformed_done_item', [{ type: 'response.output_item.done', item: 'never-retain-credential' }]],
  [
    'too_many_done_images',
    Array.from({ length: 5 }, (_, i) => ({
      type: 'response.output_item.done',
      item: { ...item, id: `fixture-${i}` },
      output_index: i,
    })),
  ],
])('closed image refusal reason distinguishes %s without upstream text or retry', async (reason, events) => {
  const fetcher = vi.fn<typeof fetch>(async () => reply(wire(events)))
  let caught: unknown
  try {
    await call(fetcher)
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(ImageProtocolFailure)
  expect(String(caught)).toContain(`[reason=${reason}]`)
  expect(String(caught)).not.toContain('never-retain-credential')
  expect(String(caught)).not.toContain(png)
  expect(fetcher).toHaveBeenCalledTimes(1)
})

test('refusal reason never promotes completed metadata or substitutes empty terminal evidence', async () => {
  // These three bodies all used to report evidence/missing/completed. They are not equivalent.
  for (const [response, reason] of [
    [{ output: [] }, 'evidence_response'],
    [{ output: [item], status: 'failed' }, 'terminal_status'],
    [{ output: [{ ...item, result: '' }] }, 'missing_image_bytes'],
  ] as const) {
    await expect(call(async () => reply(wire([{ ...complete, response }])))).rejects.toThrow(
      `terminal=completed] [reason=${reason}]`,
    )
  }
  await expect(
    call(async () => reply(wire([complete]) + 'data: [DONE]\n\n' + wire([complete]))),
  ).rejects.toThrow('reason=event_after_done')
})

test('exported image diagnostic validates all fields at runtime without coercing foreign values', () => {
  const foreign = { toString: vi.fn(() => 'never-retain-credential') }
  for (const value of ['never-retain-credential', foreign, null, [], 1]) {
    const error = Reflect.construct(ImageProtocolFailure, [value, value, value, value])
    expect(String(error)).toContain(
      '[phase=evidence; media=other; terminal=unseen] [reason=internal_failure]',
    )
    expect(String(error)).not.toContain('never-retain-credential')
  }
  expect(foreign.toString).not.toHaveBeenCalled()
})

test('API-key codec does not gain missing-MIME SSE acceptance', async () => {
  await expect(call(async () => reply(wire([complete])), 'openai')).rejects.toThrow()
  const result = await call(
    async () => reply(JSON.stringify({ data: [{ b64_json: png }] })),
    'openai',
  )
  expect(result.output).toHaveLength(1)
})
