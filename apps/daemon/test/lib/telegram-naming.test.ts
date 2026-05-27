// Topic-name templating + color-allocation tests.

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { registerGroup } from '../../src/core/group/register.ts'
import * as groupRepo from '../../src/core/repos/groups.ts'
import {
  allocateGroupColor,
  DEFAULT_GROUP_ID,
  GROUP_COLORS,
  SERVICE_TOPIC_COLOR,
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
  test('default group uses the bare agent name', () => {
    const name = topicNameFor({ name: 'researcher' }, { id: DEFAULT_GROUP_ID })
    expect(name).toBe('researcher')
  })

  test('non-default group prefixes with group slug + arrow', () => {
    const name = topicNameFor({ name: 'researcher' }, { id: 'home-reno' })
    expect(name).toBe('home-reno › researcher')
  })

  test('preserves spaces and special characters in agent names', () => {
    const name = topicNameFor({ name: "Patrizio's Coder" }, { id: 'work' })
    expect(name).toBe("work › Patrizio's Coder")
  })
})

describe('allocateGroupColor', () => {
  test('first group gets the first color in the rotation', () => {
    registerGroup(env.db, { id: DEFAULT_GROUP_ID, name: 'default' }, env.paths)
    const color = allocateGroupColor(env.db, DEFAULT_GROUP_ID)
    expect(color).toBe(GROUP_COLORS[0])
  })

  test('subsequent groups round-robin through the 5 non-red colors', () => {
    // Drop env.groupId-style "test-group" and start fresh — we want a
    // controlled allocation sequence.
    registerGroup(env.db, { id: 'a', name: 'a' }, env.paths)
    registerGroup(env.db, { id: 'b', name: 'b' }, env.paths)
    registerGroup(env.db, { id: 'c', name: 'c' }, env.paths)

    expect(allocateGroupColor(env.db, 'a')).toBe(GROUP_COLORS[0])
    expect(allocateGroupColor(env.db, 'b')).toBe(GROUP_COLORS[1])
    expect(allocateGroupColor(env.db, 'c')).toBe(GROUP_COLORS[2])
  })

  test('is idempotent — re-allocating returns the same color', () => {
    registerGroup(env.db, { id: 'a', name: 'a' }, env.paths)
    const first = allocateGroupColor(env.db, 'a')
    const second = allocateGroupColor(env.db, 'a')
    const third = allocateGroupColor(env.db, 'a')
    expect(first).toBe(second)
    expect(second).toBe(third)
  })

  test('wraps after exhausting the 5-color rotation', () => {
    for (const slug of ['g0', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6']) {
      registerGroup(env.db, { id: slug, name: slug }, env.paths)
      allocateGroupColor(env.db, slug)
    }
    // The 6th group (g5) wraps back to color 0; g6 to color 1.
    expect(groupRepo.getTelegramIconColor(env.db, 'g5')).toBe(GROUP_COLORS[0])
    expect(groupRepo.getTelegramIconColor(env.db, 'g6')).toBe(GROUP_COLORS[1])
  })

  test('service-topic color is not in the group rotation', () => {
    // The doc reserves red for ⚙ bazilion — make sure the constant matches
    // and is excluded from the round-robin list.
    expect(SERVICE_TOPIC_COLOR).toBe(16478047)
    expect(GROUP_COLORS).not.toContain(SERVICE_TOPIC_COLOR)
  })
})

describe('topicDeepLink', () => {
  test('builds the three-segment form so iOS opens INTO the topic', () => {
    // Trailing /<topic> repeats the topic id deliberately — anchors to the
    // topic's creation system message, which always exists.
    const url = topicDeepLink(-1003964430972, 11)
    expect(url).toBe('https://t.me/c/3964430972/11/11')
  })

  test('handles supergroups whose magnitude does not start with 100', () => {
    // Hypothetical (Telegram always prefixes -100 for supergroups in practice
    // but the helper should still produce a sane link for unprefixed ids).
    const url = topicDeepLink(-9999, 42)
    expect(url).toBe('https://t.me/c/9999/42/42')
  })
})
