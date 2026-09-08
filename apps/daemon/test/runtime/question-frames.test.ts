import type { ChatFrame } from '@bazilion/api-types'
import { expect, test } from 'vitest'
import { translatePiEvent } from '../../src/runtime/pi/events.ts'
import { sanitizeQuestionWorkerFrame } from '../../src/runtime/worker/question-frames.ts'

test('worker frames cannot release question payloads through calls, results, images or done', () => {
  const frames: ChatFrame[] = [
    {
      kind: 'event',
      event: { type: 'tool_call', id: 'call', name: 'ask_user', arguments: 'PRIVATE_CONTENT' },
    },
    {
      kind: 'event',
      event: {
        type: 'tool_result',
        id: 'call',
        name: 'ask_user',
        result: 'PRIVATE_CONTENT',
        images: [{ data: 'PRIVATE_CONTENT', mimeType: 'image/png' }],
      },
    },
    {
      kind: 'event',
      event: { type: 'tool_error', id: 'call', name: 'ask_user', error: 'PRIVATE_CONTENT' },
    },
    {
      kind: 'done',
      messages: [
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call', name: 'ask_user', arguments: 'PRIVATE_CONTENT' }],
        },
        { role: 'tool', toolName: 'ask_user', toolCallId: 'call', content: 'PRIVATE_CONTENT' },
      ],
    },
  ]
  for (const frame of frames)
    expect(JSON.stringify(sanitizeQuestionWorkerFrame(frame))).not.toContain('PRIVATE_CONTENT')
})
test('worker-created cards are rejected and ordinary tool output is preserved', () => {
  const forged = {
    kind: 'event',
    event: { type: 'agent_question', question: { question: 'PRIVATE_CONTENT' } },
  } as unknown as ChatFrame
  expect(sanitizeQuestionWorkerFrame(forged)).toEqual({
    kind: 'fatal',
    error: 'Worker cannot emit daemon-owned question cards',
  })
  const normal: ChatFrame = {
    kind: 'event',
    event: { type: 'tool_result', id: 'call', name: 'read', result: 'normal output' },
  }
  expect(sanitizeQuestionWorkerFrame(normal)).toBe(normal)
})
test('Pi adapter also withholds raw question result text before stdout', () => {
  const event = {
    type: 'tool_execution_end',
    toolCallId: 'call',
    toolName: 'ask_user',
    isError: true,
    result: { content: [{ type: 'text', text: 'PRIVATE_CONTENT' }] },
  } as Parameters<typeof translatePiEvent>[0]
  expect(JSON.stringify(translatePiEvent(event))).not.toContain('PRIVATE_CONTENT')
})
