import type { Agent, Profile, Team } from '@bazilion/api-types'
import { expect, test } from 'vitest'
import { isGroupOpen } from '../src/components/workspace/rail/open-groups.ts'
import { slimTeams, sortProfiles, sortTeams } from '../src/components/workspace/rail/order.ts'

const team = (id: string) => ({ id, name: id }) as Team
const agent = (id: string, teamId: string) => ({ id, name: id, teamId }) as Agent
const ids = (list: { id: string }[]) => list.map((entry) => entry.id)

test('the Default Team and the default template come first, the rest keep their order', () => {
  const teams = [team('launch'), team('default'), team('ops')]
  expect(ids(sortTeams(teams))).toEqual(['default', 'launch', 'ops'])
  expect(ids(teams)).toEqual(['launch', 'default', 'ops'])

  const profiles = [{ id: 'writer' }, { id: 'coder' }, { id: 'default' }] as Profile[]
  expect(ids(sortProfiles(profiles))).toEqual(['default', 'writer', 'coder'])
})

test('the folded rail shows only Teams with Agents, the Team in view first', () => {
  const teams = [team('launch'), team('default'), team('empty'), team('ops')]
  const agents = [agent('a', 'ops'), agent('b', 'default'), agent('c', 'launch')]
  expect(ids(slimTeams(teams, agents, undefined))).toEqual(['default', 'launch', 'ops'])
  expect(ids(slimTeams(teams, agents, 'ops'))).toEqual(['ops', 'default', 'launch'])
  expect(ids(slimTeams(teams, agents, 'empty'))).toEqual(['default', 'launch', 'ops'])
})

test('a Team the user opened or closed stays so; otherwise the one in view and the default are open', () => {
  expect(isGroupOpen({}, 'default', false)).toBe(true)
  expect(isGroupOpen({}, 'launch', true)).toBe(true)
  expect(isGroupOpen({}, 'launch', false)).toBe(false)
  expect(isGroupOpen({ default: false, launch: false }, 'default', false)).toBe(false)
  expect(isGroupOpen({ launch: false }, 'launch', true)).toBe(false)
  expect(isGroupOpen({ ops: true }, 'ops', false)).toBe(true)
})
