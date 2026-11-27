import type { Agent, Profile, Team } from '@bazilion/api-types'
import { expect, test } from 'vitest'
import { isGroupOpen } from '../src/components/workspace/rail/open-groups.ts'
import {
  inOrder,
  moveBy,
  moveNextTo,
  slimTeams,
  sortProfiles,
} from '../src/components/workspace/rail/order.ts'

const team = (id: string) => ({ id, name: id }) as Team
const agent = (id: string, teamId: string) => ({ id, name: id, teamId }) as Agent
const ids = (list: { id: string }[]) => list.map((entry) => entry.id)

test('the default template comes first, the rest keep their order', () => {
  const profiles = [{ id: 'writer' }, { id: 'coder' }, { id: 'default' }] as Profile[]
  expect(ids(sortProfiles(profiles))).toEqual(['default', 'writer', 'coder'])
})

test("the folded rail shows only Teams with Agents, in the owner's order, the Team in view first", () => {
  const teams = [team('launch'), team('default'), team('empty'), team('ops')]
  const agents = [agent('a', 'ops'), agent('b', 'default'), agent('c', 'launch')]
  expect(ids(slimTeams(teams, agents, undefined))).toEqual(['launch', 'default', 'ops'])
  expect(ids(slimTeams(teams, agents, 'ops'))).toEqual(['ops', 'launch', 'default'])
  expect(ids(slimTeams(teams, agents, 'empty'))).toEqual(['launch', 'default', 'ops'])
})

test('a drag or a Move gives the new order at once; what it does not name keeps its place', () => {
  const list = ['a', 'b', 'c', 'd']
  expect(moveNextTo(list, 'd', 'b', false)).toEqual(['a', 'd', 'b', 'c'])
  expect(moveNextTo(list, 'a', 'c', true)).toEqual(['b', 'c', 'a', 'd'])
  expect(moveNextTo(list, 'a', 'a', true)).toEqual(list)
  expect(moveNextTo(list, 'x', 'a', true)).toEqual(list)
  expect(moveBy(list, 'b', -1)).toEqual(['b', 'a', 'c', 'd'])
  expect(moveBy(list, 'd', 1)).toEqual(list)
  expect(moveBy(list, 'a', -1)).toEqual(list)
  const teams = [team('a'), team('b'), team('c')]
  expect(ids(inOrder(teams, ['c', 'a']))).toEqual(['c', 'a', 'b'])
  expect(ids(inOrder(teams))).toEqual(['a', 'b', 'c'])
})

test('a Team the user opened or closed stays so; otherwise the one in view and the default are open', () => {
  expect(isGroupOpen({}, 'default', false)).toBe(true)
  expect(isGroupOpen({}, 'launch', true)).toBe(true)
  expect(isGroupOpen({}, 'launch', false)).toBe(false)
  expect(isGroupOpen({ default: false, launch: false }, 'default', false)).toBe(false)
  expect(isGroupOpen({ launch: false }, 'launch', true)).toBe(false)
  expect(isGroupOpen({ ops: true }, 'ops', false)).toBe(true)
})
