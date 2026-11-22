// The palette's order and the keys that move between Agents.
import type { AgentActivity } from '@bazilion/api-types'
import { expect, test } from 'vitest'
import { orderAgents } from '../src/components/JumpPalette.tsx'
import { neighbour, SHORTCUTS } from '../src/lib/shortcuts.ts'

const activity = (agentId: string, more: Partial<AgentActivity>): AgentActivity => ({
  agentId,
  teamId: 'launch',
  working: false,
  step: null,
  questions: 0,
  approvals: 0,
  queuePaused: false,
  lastActivityAt: null,
  results: 0,
  lastResultAt: null,
  ...more,
})

test('the palette lists who waits for you, then who works, then the rest by last activity', () => {
  const agents = ['mira', 'dev', 'pixel', 'quill', 'scout'].map((id) => ({ id }))
  const feed = new Map(
    [
      activity('mira', { lastActivityAt: 10 }),
      activity('dev', { lastActivityAt: 30 }),
      activity('pixel', { approvals: 1 }),
      activity('quill', { questions: 1 }),
      activity('scout', { working: true }),
    ].map((entry) => [entry.agentId, entry]),
  )
  const order = orderAgents(agents, feed)
  expect(order.waiting.map((agent) => agent.id)).toEqual(['pixel', 'quill'])
  expect(order.working.map((agent) => agent.id)).toEqual(['scout'])
  expect(order.rest.map((agent) => agent.id)).toEqual(['dev', 'mira'])
})

test('the next and previous Agent wrap round, and start at an end when none is open', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  expect(neighbour(list, 'a', 1)?.id).toBe('b')
  expect(neighbour(list, 'c', 1)?.id).toBe('a')
  expect(neighbour(list, 'a', -1)?.id).toBe('c')
  expect(neighbour(list, undefined, 1)?.id).toBe('a')
  expect(neighbour(list, undefined, -1)?.id).toBe('c')
  expect(neighbour([], 'a', 1)).toBeUndefined()
})

test('the shortcuts are written as this keyboard has them', () => {
  const palette = SHORTCUTS[0]
  expect(palette?.keys(true)).toEqual(['⌘', 'K'])
  expect(palette?.keys(false)).toEqual(['Ctrl', 'K'])
})
