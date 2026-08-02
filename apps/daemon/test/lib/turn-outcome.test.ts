import type { ChatFrame } from '@bazilion/api-types'
import { describe, expect, test } from 'vitest'
import { turnFrameFailure } from '../../src/lib/turn-outcome.ts'

describe('turnFrameFailure', () => {
  test.each([
    [{ kind: 'event', event: { type: 'error', error: 'provider failed' } }, 'provider failed'],
    [{ kind: 'fatal', error: 'worker crashed' }, 'worker crashed'],
  ] satisfies Array<[ChatFrame, string]>)('classifies %s as a turn failure', (frame, error) => {
    expect(turnFrameFailure(frame)).toBe(error)
  })

  test.each([
    { kind: 'done', messages: [] },
    {
      kind: 'event',
      event: { type: 'tool_error', id: 'call-1', name: 'bash', error: 'exit 1' },
    },
  ] satisfies ChatFrame[])('does not classify %s as a turn failure', (frame) => {
    expect(turnFrameFailure(frame)).toBeNull()
  })
})
