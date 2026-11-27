// BAZ-097: what a tab does with an Agent's screen call, the progress cards of a conversation, and
// the sealed document a canvas is shown in.
import { expect, test } from 'vitest'
import { progressBoard, readProgress } from '../src/components/chat/Progress.tsx'
import { canvasDocument } from '../src/components/files/CanvasFrame.tsx'
import { screenSearch } from '../src/components/workspace/agent-screen.ts'

test('screen opens a panel tab, a view or a sheet, and conversation closes them', () => {
  const here = { agent: 'a1', panel: 'team' as const, view: 'files' as const, result: 'r1' }
  expect(screenSearch(here, { kind: 'panel', tab: 'changes' })).toEqual({
    agent: 'a1',
    panel: 'changes',
    view: undefined,
    file: undefined,
    result: undefined,
    section: undefined,
  })
  expect(screenSearch({ agent: 'a1' }, { kind: 'view', view: 'changes' })).toMatchObject({
    agent: 'a1',
    view: 'changes',
  })
  expect(screenSearch(here, { kind: 'sheet', sheet: 'schedules' })).toMatchObject({
    section: 'schedules',
    view: undefined,
  })
  expect(screenSearch(here, { kind: 'conversation' })).toMatchObject({ view: undefined })
  expect(screenSearch(here, { kind: 'theme', theme: 'dark' })).toBeNull()
})

test('a conversation shows one card per task, where it was first put, as it was last', () => {
  const call = (id: string, args: object) => ({
    kind: 'call' as const,
    id,
    name: 'progress',
    body: JSON.stringify(args),
  })
  const board = progressBoard([
    {
      type: 'tool',
      items: [call('c1', { task: 'Deploy', steps: [{ step: 'Build', state: 'doing' }] })],
    },
    { type: 'assistant', content: 'Building.' },
    {
      type: 'tool',
      items: [call('c2', { id: 'c1', task: 'Deploy', steps: [{ step: 'Build', state: 'done' }] })],
    },
    {
      type: 'tool',
      items: [call('c3', { task: 'Other', steps: [{ step: 'One', state: 'todo' }] })],
    },
  ])
  expect([...board.shownAt]).toEqual([
    ['c1', 'c1'],
    ['c3', 'c3'],
  ])
  expect(board.latest.get('c1')).toEqual({
    task: 'Deploy',
    steps: [{ step: 'Build', state: 'done' }],
  })
  expect(readProgress('c9', 'not json')).toBeNull()
})

test("a canvas document starts with the frame's own policy, before what the Agent wrote", () => {
  const doc = canvasDocument(
    '<meta http-equiv="Content-Security-Policy" content="default-src *"><p>hi</p>',
    false,
  )
  expect(doc.indexOf("default-src 'none'")).toBeGreaterThan(0)
  expect(doc.indexOf("default-src 'none'")).toBeLessThan(doc.indexOf('default-src *'))
  expect(doc.startsWith('<!doctype html>')).toBe(true)
  expect(canvasDocument('<svg></svg>', true)).toContain('svg{display:block')
})
