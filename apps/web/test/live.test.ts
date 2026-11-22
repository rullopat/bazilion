import type { AttentionItem } from '@bazilion/api-types'
import { expect, test } from 'vitest'
import { newlyWaiting } from '../src/lib/desktop-notifications'
import { parseLiveEvent } from '../src/lib/live'

const item = (key: string, occurredAt: number): AttentionItem => ({
  key,
  kind: 'agent_question',
  severity: 'action_required',
  sourceId: key,
  agentId: 'a',
  occurredAt,
  updatedAt: occurredAt,
  title: `${key} is waiting for your answer`,
  diagnostic: 'Which headline?',
  href: '/?agent=a',
  acknowledgeable: false,
  acknowledgedAt: null,
})

test('a live event is parsed; anything else is ignored', () => {
  expect(parseLiveEvent('{"type":"activity","agents":[]}')).toEqual({
    type: 'activity',
    agents: [],
  })
  expect(parseLiveEvent('{"type":"other"}')).toBeNull()
  expect(parseLiveEvent('not json')).toBeNull()
  expect(parseLiveEvent('null')).toBeNull()
})

test('only items that started waiting since the last event notify, oldest first, a few at most', () => {
  const known = new Set(['q:1'])
  const waiting = [item('q:5', 5), item('q:1', 1), item('q:3', 3), item('q:4', 4), item('q:2', 2)]
  expect(newlyWaiting(known, waiting).map((entry) => entry.key)).toEqual(['q:2', 'q:3', 'q:4'])
  expect(newlyWaiting(new Set(waiting.map((entry) => entry.key)), waiting)).toEqual([])
})
