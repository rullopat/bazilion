// Topic-name templating + color-allocation tests.

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import * as teamRepo from '../../src/core/repos/teams.ts'
import { registerTeam } from '../../src/core/team/register.ts'
import {
  allocateGroupColor,
  DEFAULT_TEAM_ID,
  SERVICE_TOPIC_COLOR,
  TEAM_COLORS,
  topicDeepLink,
  topicNameFor,
} from '../../src/lib/telegram/naming.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
beforeEach(() => {
  env = makeTestEnv()
})
afterEach(() => env.cleanup())

describe('topicNameFor', () => {
  test('default team uses the bare agent name', () => {
    const name = topicNameFor({ name: 'researcher' }, { id: DEFAULT_TEAM_ID })
    expect(name).toBe('researcher')
  })

  test('non-default team prefixes with team slug + arrow', () => {
    const name = topicNameFor({ name: 'researcher' }, { id: 'home-reno' })
    expect(name).toBe('home-reno › researcher')
  })

  test('preserves spaces and special characters in agent names', () => {
    const name = topicNameFor({ name: "Patrizio's Coder" }, { id: 'work' })
    expect(name).toBe("work › Patrizio's Coder")
  })
})

describe('allocateGroupColor', () => {
  test('first team gets the first color in the rotation', () => {
    registerTeam(env.db, { id: DEFAULT_TEAM_ID, name: 'default' }, env.paths)
    const color = allocateGroupColor(env.db, DEFAULT_TEAM_ID)
    expect(color).toBe(TEAM_COLORS[0])
  })

  test('subsequent teams round-robin through the 5 non-red colors', () => {
    // Drop env.teamId-style "test-team" and start fresh — we want a
    // controlled allocation sequence.
    registerTeam(env.db, { id: 'a', name: 'a' }, env.paths)
    registerTeam(env.db, { id: 'b', name: 'b' }, env.paths)
    registerTeam(env.db, { id: 'c', name: 'c' }, env.paths)

    expect(allocateGroupColor(env.db, 'a')).toBe(TEAM_COLORS[0])
    expect(allocateGroupColor(env.db, 'b')).toBe(TEAM_COLORS[1])
    expect(allocateGroupColor(env.db, 'c')).toBe(TEAM_COLORS[2])
  })

  test('is idempotent — re-allocating returns the same color', () => {
    registerTeam(env.db, { id: 'a', name: 'a' }, env.paths)
    const first = allocateGroupColor(env.db, 'a')
    const second = allocateGroupColor(env.db, 'a')
    const third = allocateGroupColor(env.db, 'a')
    expect(first).toBe(second)
    expect(second).toBe(third)
  })

  test('wraps after exhausting the 5-color rotation', () => {
    for (const slug of ['g0', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6']) {
      registerTeam(env.db, { id: slug, name: slug }, env.paths)
      allocateGroupColor(env.db, slug)
    }
    // The 6th team (g5) wraps back to color 0; g6 to color 1.
    expect(teamRepo.getTelegramIconColor(env.db, 'g5')).toBe(TEAM_COLORS[0])
    expect(teamRepo.getTelegramIconColor(env.db, 'g6')).toBe(TEAM_COLORS[1])
  })

  test('service-topic color is not in the team rotation', () => {
    // The doc reserves red for ⚙ bazilion — make sure the constant matches
    // and is excluded from the round-robin list.
    expect(SERVICE_TOPIC_COLOR).toBe(16478047)
    expect(TEAM_COLORS).not.toContain(SERVICE_TOPIC_COLOR)
  })
})

describe('topicDeepLink', () => {
  test('strips the -100 supergroup prefix from the chat id', () => {
    const url = topicDeepLink(-1003964430972, 11)
    expect(url).toBe('https://t.me/c/3964430972/11')
  })

  test('handles supergroups whose magnitude does not start with 100', () => {
    // Hypothetical (Telegram always prefixes -100 for supergroups in practice
    // but the helper should still produce a sane link for unprefixed ids).
    const url = topicDeepLink(-9999, 42)
    expect(url).toBe('https://t.me/c/9999/42')
  })
})
