import type { AgentActivity } from '@bazilion/api-types'
import { expect, test } from 'vitest'
import { filterDestinations } from '../src/components/JumpPalette.tsx'
import { agentState, shortTime, teamSummary, turnEnded } from '../src/lib/activity.tsx'

const idle: AgentActivity = {
  agentId: 'a1',
  teamId: 'launch',
  working: false,
  step: null,
  questions: 0,
  approvals: 0,
  queuePaused: false,
  lastActivityAt: 1_000,
  results: 2,
  lastResultAt: 900,
}

test("an Agent's line says what needs the operator first, then the work, then what is new", () => {
  expect(agentState(undefined, undefined)).toEqual({ kind: 'idle', text: 'Idle' })
  expect(agentState({ ...idle, lastActivityAt: null }, undefined).text).toBe('No conversation yet')
  expect(agentState({ ...idle, working: true, questions: 1 }, undefined)).toEqual({
    kind: 'needs',
    text: 'Waiting for you: a question',
  })
  expect(agentState({ ...idle, working: true, approvals: 2 }, undefined).text).toBe(
    'Waiting for you: 2 commands to approve',
  )
  expect(
    agentState(
      { ...idle, working: true, step: { tool: 'write', target: 'site/theme.js' } },
      undefined,
    ),
  ).toEqual({ kind: 'working', text: 'Working: writing theme.js' })
  expect(
    agentState(
      { ...idle, working: true, step: { tool: 'send_message', target: 'a2' } },
      undefined,
      (id) => (id === 'a2' ? 'Pixel' : undefined),
    ).text,
  ).toBe('Working: messaging Pixel')
  expect(agentState({ ...idle, working: true }, undefined).text).toBe('Working')
  expect(agentState({ ...idle, queuePaused: true }, undefined).kind).toBe('paused')
})

test('what is new is measured against what the operator last saw', () => {
  expect(agentState(idle, { at: 1_000, results: 2 }).kind).toBe('idle')
  expect(agentState(idle, { at: 1_000, results: 0 })).toEqual({
    kind: 'fresh',
    text: '2 new files',
  })
  expect(agentState(idle, { at: 500, results: 2 })).toEqual({ kind: 'fresh', text: 'New activity' })
  // Without a marker (the open conversation) nothing is new.
  expect(agentState(idle, undefined).kind).toBe('idle')
})

test("a Team's header counts who waits, who works and who has news", () => {
  expect(
    teamSummary([
      { kind: 'needs', text: '' },
      { kind: 'working', text: '' },
      { kind: 'working', text: '' },
      { kind: 'idle', text: '' },
    ]),
  ).toBe('1 waiting · 2 working')
  expect(teamSummary([{ kind: 'idle', text: '' }])).toBe('')
})

test('a turn that ended between two readings of the feed is noticed', () => {
  expect(turnEnded([{ ...idle, working: true }], [idle])).toBe(true)
  // A turn shorter than the time between readings: the conversation moved on.
  expect(turnEnded([idle], [{ ...idle, lastActivityAt: 2_000 }])).toBe(true)
  expect(turnEnded([idle], [{ ...idle, results: 3 }])).toBe(true)
  expect(turnEnded([idle], [idle])).toBe(false)
  // Still working: not yet.
  expect(turnEnded([idle], [{ ...idle, working: true, lastActivityAt: 2_000 }])).toBe(false)
  // An Agent met for the first time ended nothing.
  expect(turnEnded([], [idle])).toBe(false)
})

test('a time reads as a clock today and as a date before', () => {
  const now = new Date(2026, 10, 19, 15, 0).getTime()
  expect(shortTime(new Date(2026, 10, 19, 9, 5).getTime(), now)).toMatch(/9[:.]05/)
  expect(shortTime(new Date(2026, 10, 1, 9, 5).getTime(), now)).toMatch(/1/)
})

test('Jump to keeps the destinations that hold every word typed', () => {
  const all = [
    { label: 'Pixel', hint: 'Launch · Idle' },
    { label: 'Dev', hint: 'Launch · Working' },
    { label: 'Scout', hint: 'Research · Idle' },
  ]
  expect(filterDestinations(all, 'launch idle')).toEqual([all[0]])
  expect(filterDestinations(all, '  ')).toEqual(all)
  expect(filterDestinations(all, 'nobody')).toEqual([])
})
