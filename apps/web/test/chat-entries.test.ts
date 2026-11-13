import type { ChatFrame, ProviderMessage } from '@bazilion/api-types'
import { expect, test } from 'vitest'
import {
  applyEvent,
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
