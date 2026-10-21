import { expect, test } from 'vitest'
import { CompletedImageEvidence, ImageEvidenceError } from '../../src/lib/image-evidence.ts'

const image = {
  id: 'ig_a',
  type: 'image_generation_call',
  status: 'completed',
  result: 'synthetic-final-bytes',
}
const start = {
  type: 'response.created',
  response: { id: 'resp_a', status: 'in_progress', model: 'gpt-6-astra', output: [] },
}
const done = (item: Record<string, unknown> = image, output_index = 0) => ({
  type: 'response.output_item.done',
  item,
  output_index,
})
const end = (output: unknown = [], extra: Record<string, unknown> = {}) => ({
  type: 'response.completed',
  response: { id: 'resp_a', status: 'completed', output, ...extra },
})
const run = (events: unknown[]) => {
  const evidence = new CompletedImageEvidence()
  for (const event of events) evidence.observe(event)
  return evidence.resolve()
}
const message = {
  id: 'msg_a',
  type: 'message',
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text: 'synthetic', annotations: [] }],
}
const reasoning = {
  id: 'rs_a',
  type: 'reasoning',
  summary: [{ type: 'summary_text', text: 'synthetic' }],
}
const add = (item: Record<string, unknown>, output_index = 0) => ({
  type: 'response.output_item.added',
  item,
  output_index,
})

test.each([
  'empty',
  'omitted',
])('staged recovery uses only complete snapshots with %s output', (shape) => {
  const terminal =
    shape === 'empty'
      ? end()
      : { type: 'response.completed', response: { id: 'resp_a', status: 'completed' } }
  const result = run([start, done(reasoning, 0), done(image, 1), done(message, 2), terminal])
  expect(result).toEqual({ output: [reasoning, image, message], outputSource: 'completed_stream' })
})

test('progress and partial images bind identities but only done bytes become evidence', () => {
  const result = run([
    start,
    add({ id: 'ig_a', type: 'image_generation_call', status: 'in_progress' }),
    {
      type: 'response.image_generation_call.partial_image',
      item_id: 'ig_a',
      output_index: 0,
      partial_image_b64: 'not-final',
    },
    { type: 'response.image_generation_call.completed', item_id: 'ig_a', output_index: 0 },
    done(),
    end(),
  ])
  expect(result.output).toEqual([image])
})

test('populated output stays authoritative and terminal-only optional image metadata remains optional', () => {
  expect(run([end([{ type: 'image_generation_call', result: 'synthetic' }])]).outputSource).toBe(
    'terminal',
  )
  expect(
    run([
      start,
      add({ id: 'ig_a', type: 'image_generation_call', status: 'in_progress' }),
      end([image]),
    ]).output,
  ).toEqual([image])
  expect(run([start, done(), end([image])]).output).toEqual([image])
})

test('supplied sequence numbers increase across gaps and omitted sequence fields', () => {
  expect(
    run([{ ...start, sequence_number: 0 }, done(), { ...end(), sequence_number: 5 }]).outputSource,
  ).toBe('completed_stream')
})

test.each([
  ['no lifecycle', [done(), end()]],
  [
    'annotation event cannot disappear',
    [
      start,
      {
        type: 'response.output_text.annotation.added',
        output_index: 1,
        item_id: 'msg_a',
        annotation: { type: 'url_citation', url: 'https://synthetic.invalid' },
      },
      done(),
      done(message, 1),
      end(),
    ],
  ],
  [
    'annotation part cannot disappear',
    [
      start,
      {
        type: 'response.content_part.done',
        output_index: 1,
        item_id: 'msg_a',
        part: {
          type: 'output_text',
          text: 'synthetic',
          annotations: [{ type: 'url_citation', url: 'https://synthetic.invalid' }],
        },
      },
      done(),
      done(message, 1),
      end(),
    ],
  ],
  ['missing terminal status', [start, done(), end([], { status: undefined })]],
  ['missing terminal id', [start, done(), end([], { id: undefined })]],
  ['changed response id', [start, done(), end([], { id: 'resp_other' })]],
  ['changed event response id', [start, { ...done(), response_id: 'resp_other' }, end()]],
  ['missing response completion', [start, done()]],
  [
    'wrong lifecycle model',
    [{ ...start, response: { ...start.response, model: 'other' } }, done(), end()],
  ],
  ['wrong terminal model', [start, done(), end([], { model: 'other' })]],
  ['wrong image model', [start, done({ ...image, model: 'other' }), end()]],
  ['wrong image format', [start, done({ ...image, output_format: 'jpeg' }), end()]],
  ['failed terminal', [start, done(), end([], { status: 'failed' })]],
  ['terminal error', [start, done(), end([], { error: { message: 'secret-fixture' } })]],
  ['terminal incomplete', [start, done(), end([], { incomplete_details: {} })]],
  ['late failure', [start, done(), end(), { type: 'error' }]],
  ['duplicate terminal', [start, done(), end(), end()]],
  ['null output', [start, done(), end(null)]],
  ['text-only terminal cannot fallback', [start, done(), end([message])]],
  ['no image', [start, done(reasoning), end()]],
  [
    'partial-only',
    [
      start,
      {
        type: 'response.image_generation_call.partial_image',
        item_id: 'ig_a',
        output_index: 0,
        partial_image_b64: image.result,
      },
      end(),
    ],
  ],
  [
    'completion progress only',
    [
      start,
      { type: 'response.image_generation_call.completed', item_id: 'ig_a', output_index: 0 },
      end(),
    ],
  ],
  ['failed snapshot', [start, done({ ...image, status: 'failed' }), end()]],
  ['missing snapshot status', [start, done({ ...image, status: undefined }), end()]],
  ['missing image bytes', [start, done({ ...image, result: null }), end()]],
  ['missing item identity', [start, done({ ...image, id: undefined }), end()]],
  ['invalid item identity newline', [start, done({ ...image, id: 'ig_a\n' }), end()]],
  ['invalid item index', [start, done(image, -1), end()]],
  ['index bound', [start, done(image, 128), end()]],
  ['noncontiguous snapshots', [start, done(image, 1), end()]],
  ['unclosed message slot', [start, done(), add({ id: 'msg_a', type: 'message' }, 1), end()]],
  ['duplicate snapshot', [start, done(), done(), end()]],
  [
    'duplicate opening',
    [
      start,
      add({ id: 'ig_a', type: 'image_generation_call' }),
      add({ id: 'ig_a', type: 'image_generation_call' }),
      done(),
      end(),
    ],
  ],
  [
    'changed index',
    [start, add({ id: 'ig_a', type: 'image_generation_call' }), done(image, 1), end()],
  ],
  [
    'changed slot identity',
    [start, add({ id: 'ig_b', type: 'image_generation_call' }), done(), end()],
  ],
  ['changed slot type', [start, add({ id: 'ig_a', type: 'message' }), done(), end()]],
  ['contradictory event item identity', [start, { ...done(), item_id: 'ig_b' }, end()]],
  [
    'progress after snapshot',
    [
      start,
      done(),
      { type: 'response.image_generation_call.generating', item_id: 'ig_a', output_index: 0 },
      end(),
    ],
  ],
  [
    'unknown item-bearing event',
    [start, { type: 'response.unknown', output_index: 0, item_id: 'ig_a' }, done(), end()],
  ],
  ['unknown capability', [start, done({ ...image, type: 'function_call' }), end()]],
  [
    'refusal event',
    [start, { type: 'response.refusal.delta', delta: 'secret-fixture' }, done(), end()],
  ],
  [
    'refusal message',
    [
      start,
      done(),
      done({ ...message, content: [{ type: 'refusal', refusal: 'secret-fixture' }] }, 1),
      end(),
    ],
  ],
  [
    'refusal part',
    [
      start,
      {
        type: 'response.content_part.done',
        output_index: 1,
        item_id: 'msg_a',
        part: { type: 'refusal', refusal: 'secret-fixture' },
      },
      done(),
      end(),
    ],
  ],
  [
    'unknown message content',
    [
      start,
      done(),
      done({ ...message, content: [{ type: 'unknown', text: 'secret-fixture' }] }, 1),
      end(),
    ],
  ],
  [
    'unfinished reasoning',
    [start, done(), done({ ...reasoning, status: 'in_progress' }, 1), end()],
  ],
  ['malformed reasoning summary', [start, done(), done({ ...reasoning, summary: null }, 1), end()]],
  ['response done alias', [start, done(), { ...end(), type: 'response.done' }]],
  ['negative sequence', [{ ...start, sequence_number: -1 }, done(), end()]],
  [
    'duplicate sequence',
    [{ ...start, sequence_number: 1 }, { ...done(), sequence_number: 1 }, end()],
  ],
  [
    'sequence reversal',
    [{ ...start, sequence_number: 3 }, { ...done(), sequence_number: 2 }, end()],
  ],
  ['string sequence', [{ ...start, sequence_number: '0' }, done(), end()]],
  ['completed image byte conflict', [start, done(), end([{ ...image, result: 'different' }])]],
  ['terminal loses streamed item', [start, done(reasoning, 0), done(image, 1), end([reasoning])]],
  ['terminal identity swap', [start, done(reasoning, 0), done(image, 1), end([image, reasoning])]],
  [
    'too many images',
    [start, ...Array.from({ length: 5 }, (_, i) => done({ ...image, id: `ig_${i}` }, i)), end()],
  ],
  [
    'nonempty opening snapshot',
    [{ ...start, response: { ...start.response, output: [image] } }, done(), end()],
  ],
  [
    'refusal hidden in added content',
    [
      start,
      add({
        ...message,
        status: 'in_progress',
        content: [{ type: 'refusal', refusal: 'secret-fixture' }],
      }),
      done(),
      end(),
    ],
  ],
])('staged evidence refuses %s without disclosing upstream values', (_, events) => {
  let error: unknown
  try {
    run(events)
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(ImageEvidenceError)
  expect(String(error)).toMatch(/^Error: Image evidence refused: [a-z_]+$/)
  expect(String(error)).not.toContain('secret-fixture')
  expect(String(error)).not.toContain(image.result)
})

test('snapshot/terminal ownership does not allow caller mutation to change resolved evidence', () => {
  const evidence = new CompletedImageEvidence()
  evidence.observe(start)
  const streamed = done({ ...image })
  evidence.observe(streamed)
  streamed.item.result = 'tampered'
  const terminal = end()
  evidence.observe(terminal)
  terminal.response.output = [message]
  const output = evidence.resolve()
  expect(output.output).toEqual([image])
  output.output[0]!.result = 'also tampered'
  expect(evidence.resolve().output).toEqual([image])
})

test('a caught refusal poisons the collector rather than permitting later recovery', () => {
  const evidence = new CompletedImageEvidence()
  evidence.observe(start)
  evidence.observe(done())
  evidence.observe(end())
  expect(() => evidence.observe({ type: 'error' })).toThrow()
  expect(() => evidence.resolve()).toThrow('failure')
  expect(() => evidence.observe(end())).toThrow('failure')
})

test('slot and event bounds are enforced before accepting excess evidence', () => {
  expect(() => run(Array.from({ length: 513 }, () => start))).toThrow('limit')
  const items: Record<string, unknown>[] = Array.from({ length: 128 }, (_, i) => ({
    ...reasoning,
    id: `rs_${i}`,
  }))
  items[127] = image
  expect(run([start, ...items.map((item, i) => done(item, i)), end()]).output).toHaveLength(128)
  expect(() => run([end([...items, { ...image, id: 'ig_b' }])])).toThrow('limit')
})
