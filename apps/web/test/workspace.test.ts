import { expect, test } from 'vitest'
import {
  isAgentSection,
  isTeamSection,
  parsePanelCookie,
  parseWorkspaceSearch,
} from '../src/lib/workspace.ts'

test('the workspace address keeps what it understands and drops the rest', () => {
  expect(
    parseWorkspaceSearch({
      agent: 'a1',
      team: 'launch',
      panel: 'changes',
      view: 'files',
      file: 'site/index.html',
      result: 'r1',
      conversation: 'c1',
      section: 'mailbox',
      note: 'brand/voice.md',
      extra: 'ignored',
    }),
  ).toEqual({
    agent: 'a1',
    team: 'launch',
    panel: 'changes',
    view: 'files',
    file: 'site/index.html',
    result: 'r1',
    conversation: 'c1',
    section: 'mailbox',
    note: 'brand/voice.md',
  })
  expect(parseWorkspaceSearch({ panel: 'none' }).panel).toBe('none')
  const dropped = parseWorkspaceSearch({ agent: '', panel: 'policy', view: 'review', section: 7 })
  expect(dropped).toEqual({})
  expect(Object.values(parseWorkspaceSearch({ agent: 42 })).every((v) => v === undefined)).toBe(
    true,
  )
})

test('a sheet belongs to the Agent or to the Team', () => {
  expect(isAgentSection('schedules')).toBe(true)
  expect(isAgentSection('memory')).toBe(false)
  expect(isTeamSection('memory')).toBe(true)
  expect(isTeamSection('browser')).toBe(false)
})

test('the side panel is remembered as its last tab, open or hidden', () => {
  expect(parsePanelCookie(undefined)).toEqual({ open: true, tab: 'team' })
  expect(parsePanelCookie('files')).toEqual({ open: true, tab: 'files' })
  expect(parsePanelCookie('none:changes')).toEqual({ open: false, tab: 'changes' })
  expect(parsePanelCookie('none:bogus')).toEqual({ open: false, tab: 'team' })
  expect(parsePanelCookie('<script>')).toEqual({ open: true, tab: 'team' })
})
