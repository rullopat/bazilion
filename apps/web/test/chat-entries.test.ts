import type { ChatFrame, ProviderMessage } from '@bazilion/api-types'
import { expect, test } from 'vitest'
import {
  applyEvent,
  groupEntries,
  pairSteps,
  projectMessages,
  type RenderEntry,
  readFrames,
  upsertToolProgress,
} from '../src/components/chat/entries.ts'

test('live tool output sits under its call line and each update replaces the last', () => {
  const entries: RenderEntry[] = [
    {
      type: 'tool',
      items: [
        { kind: 'call', id: 'a', name: 'bash', body: '{"command":"make"}' },
        { kind: 'call', id: 'b', name: 'read', body: '{}' },
      ],
    },
  ]
  const first = upsertToolProgress(entries, { id: 'a', name: 'bash', output: 'step 1\n' })
  const second = upsertToolProgress(first, { id: 'a', name: 'bash', output: 'step 1\nstep 2\n' })
  expect(second).toEqual([
    {
      type: 'tool',
      items: [
        { kind: 'call', id: 'a', name: 'bash', body: '{"command":"make"}' },
        { kind: 'progress', id: 'a', name: 'bash', body: 'step 1\nstep 2\n' },
        { kind: 'call', id: 'b', name: 'read', body: '{}' },
      ],
    },
  ])
})

test('a live turn folds into text, one tool box and deliverables outside it', () => {
  let entries: RenderEntry[] = [{ type: 'user', content: 'build it' }]
  entries = applyEvent(entries, { type: 'assistant_delta', delta: 'Work' })
  entries = applyEvent(entries, { type: 'assistant_delta', delta: 'ing' })
  entries = applyEvent(entries, { type: 'tool_call', id: 't1', name: 'bash', arguments: '{}' })
  entries = applyEvent(entries, { type: 'tool_progress', id: 't1', name: 'bash', output: 'half' })
  entries = applyEvent(entries, {
    type: 'tool_result',
    id: 't1',
    name: 'bash',
    result: 'done',
    images: [{ data: 'AAAA', mimeType: 'image/png' }],
  })
  entries = applyEvent(entries, { type: 'error', error: 'boom' })
  expect(entries).toEqual([
    { type: 'user', content: 'build it' },
    { type: 'assistant', content: 'Working' },
    {
      type: 'tool',
      items: [
        { kind: 'call', id: 't1', name: 'bash', body: '{}' },
        { kind: 'result', id: 't1', name: 'bash', body: 'done' },
      ],
    },
    { type: 'images', images: [{ data: 'AAAA', mimeType: 'image/png' }] },
    { type: 'error', content: '[error] boom' },
  ])
})

test('saved history groups tool calls with their results and lifts saved files out', () => {
  const messages: ProviderMessage[] = [
    { role: 'user', content: 'report' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'c1', name: 'deliver_file', arguments: '{"path":"r.md"}' }],
    },
    {
      role: 'tool',
      content: 'saved r.md',
      toolCallId: 'c1',
      toolName: 'deliver_file',
      results: [{ resultId: 'result-1' } as never],
    },
    { role: 'tool', content: 'Error: missing', toolCallId: 'c2', toolName: 'read' },
    { role: 'assistant', content: 'Here it is.' },
  ]
  expect(projectMessages(messages)).toEqual([
    { type: 'user', content: 'report' },
    {
      type: 'tool',
      items: [
        { kind: 'call', id: 'c1', name: 'deliver_file', body: '{"path":"r.md"}' },
        { kind: 'result', id: 'c1', name: 'deliver_file', body: 'saved r.md' },
      ],
    },
    { type: 'result', resultId: 'result-1' },
    { type: 'tool', items: [{ kind: 'error', id: 'c2', name: 'read', body: 'Error: missing' }] },
    { type: 'assistant', content: 'Here it is.' },
  ])
})

test('the NDJSON reader yields frames split across chunks and skips broken lines', async () => {
  const done: ChatFrame = { kind: 'done', messages: [] }
  const text = `${JSON.stringify({ kind: 'fatal', error: 'x' })}\nnot json\n${JSON.stringify(done)}`
  const bytes = new TextEncoder().encode(text)
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 10))
      controller.enqueue(bytes.slice(10))
      controller.close()
    },
  })
  const frames: ChatFrame[] = []
  for await (const frame of readFrames(body)) frames.push(frame)
  expect(frames).toEqual([{ kind: 'fatal', error: 'x' }, done])
})

test('each tool call is paired with what came of it', () => {
  expect(
    pairSteps([
      { kind: 'call', id: 'a', name: 'bash', body: '{"command":"make"}' },
      { kind: 'progress', id: 'a', name: 'bash', body: 'half' },
      { kind: 'call', id: 'b', name: 'read', body: '{"path":"x"}' },
      { kind: 'result', id: 'a', name: 'bash', body: 'done' },
      { kind: 'error', id: 'b', name: 'read', body: 'no such file' },
      { kind: 'call', id: 'c', name: 'write', body: '{}' },
      // A history cut before the call still shows the result.
      { kind: 'result', id: 'z', name: 'grep', body: 'match' },
    ]),
  ).toEqual([
    { id: 'a', name: 'bash', args: '{"command":"make"}', status: 'done', output: 'done' },
    { id: 'b', name: 'read', args: '{"path":"x"}', status: 'failed', output: 'no such file' },
    { id: 'c', name: 'write', args: '{}', status: 'running', output: '' },
    { id: 'z', name: 'grep', args: '', status: 'done', output: 'match' },
  ])
})

test('tool boxes and the files they delivered form one block of work', () => {
  const blocks = groupEntries([
    { type: 'user', content: 'cover image please' },
    { type: 'assistant', content: 'Two variants.' },
    { type: 'tool', items: [{ kind: 'call', id: 'a', name: 'bash', body: '{}' }] },
    { type: 'tool', items: [{ kind: 'call', id: 'b', name: 'deliver_file', body: '{}' }] },
    { type: 'result', resultId: 'r1' },
    { type: 'result', resultId: 'r2' },
    { type: 'assistant', content: 'Both attached.' },
    { type: 'result', resultId: 'r3' },
  ])
  expect(blocks.map((block) => block.type)).toEqual(['entry', 'entry', 'work', 'entry', 'work'])
  expect(blocks[2]).toMatchObject({
    type: 'work',
    index: 2,
    items: [{ id: 'a' }, { id: 'b' }],
    resultIds: ['r1', 'r2'],
  })
  expect(blocks[4]).toMatchObject({ type: 'work', index: 7, items: [], resultIds: ['r3'] })
  expect(blocks[3]).toMatchObject({ type: 'entry', index: 6 })
})

test('a stopped reply says so, from the history and live', () => {
  const history: ProviderMessage[] = [
    { role: 'user', content: 'Write the release notes' },
    { role: 'assistant', content: '', stopped: 'cancelled' },
  ]
  expect(projectMessages(history)).toEqual([
    { type: 'user', content: 'Write the release notes' },
    { type: 'stopped', reason: 'cancelled' },
  ])
  expect(applyEvent([], { type: 'error', error: 'cancelled' })).toEqual([
    { type: 'stopped', reason: 'cancelled' },
  ])
  expect(applyEvent([], { type: 'error', error: 'rate limited' })).toEqual([
    { type: 'error', content: '[error] rate limited' },
  ])
})

test('a compaction stands where its summary starts, and one that kept nothing at the end', () => {
  const mark = (index: number) => ({ index, summary: `up to ${index}`, tokensBefore: 9_000, at: 1 })
  const messages: ProviderMessage[] = [
    { role: 'user', content: 'first' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 't1', name: 'bash', arguments: '{}' }],
    },
    { role: 'tool', content: 'ok', toolCallId: 't1', toolName: 'bash' },
    { role: 'assistant', content: 'done' },
    { role: 'user', content: 'second' },
  ]
  expect(projectMessages(messages, [mark(3), mark(5)]).map((entry) => entry.type)).toEqual([
    'user',
    'tool',
    'compacted',
    'assistant',
    'user',
    'compacted',
  ])
  // A divider inside a run of work ends its tool box: steps never straddle it.
  const split = projectMessages(messages, [mark(2)])
  expect(split.map((entry) => entry.type)).toEqual([
    'user',
    'tool',
    'compacted',
    'tool',
    'assistant',
    'user',
  ])
})

test('a compaction during the turn shows while it runs and is replaced by how it ended', () => {
  const running = applyEvent([], { type: 'compaction', state: 'running' })
  expect(running).toEqual([{ type: 'compacting', state: 'running' }])
  expect(applyEvent(running, { type: 'compaction', state: 'done' })).toEqual([
    { type: 'compacting', state: 'done' },
  ])
  expect(applyEvent(running, { type: 'compaction', state: 'failed', error: 'no summary' })).toEqual(
    [{ type: 'compacting', state: 'failed', error: 'no summary' }],
  )
})

test('a tool call that was refused is a failed step, whatever its text says', () => {
  const [box] = projectMessages([
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 's', name: 'send_message', arguments: '' }],
    },
    {
      role: 'tool',
      content: 'Tool call "send_message" was not executed: the response hit the output token limit',
      toolCallId: 's',
      toolName: 'send_message',
      isError: true,
    },
  ])
  expect(box?.type === 'tool' && pairSteps(box.items).map((step) => step.status)).toEqual([
    'failed',
  ])
})
