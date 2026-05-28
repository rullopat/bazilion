// Per-group topic-name template: rendering, validation, and repo round-trip.

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { registerGroup } from '../../src/core/group/register.ts'
import * as groupRepo from '../../src/core/repos/groups.ts'
import {
  DEFAULT_GROUP_ID,
  renderTopicNameFormat,
  topicNameFor,
  validateTopicNameFormat,
} from '../../src/lib/telegram/naming.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

describe('renderTopicNameFormat', () => {
  test('substitutes all three tokens', () => {
    const out = renderTopicNameFormat('{group.name} / {agent.name} [{group.slug}]', {
      agentName: 'researcher',
      groupName: 'Home Reno',
      groupSlug: 'home-reno',
    })
    expect(out).toBe('Home Reno / researcher [home-reno]')
  })

  test('repeats a token wherever it appears', () => {
    const out = renderTopicNameFormat('{agent.name}-{agent.name}', {
      agentName: 'a',
      groupName: 'g',
      groupSlug: 'g',
    })
    expect(out).toBe('a-a')
  })
})

describe('validateTopicNameFormat', () => {
  test('accepts a format with known tokens and {agent.name}', () => {
    expect(validateTopicNameFormat('{group.name} / {agent.name}')).toBeNull()
  })

  test('rejects an unknown token', () => {
    expect(validateTopicNameFormat('{agent.name} {agent.emoji}')).toMatch(/unknown token/i)
  })

  test('rejects a format missing {agent.name}', () => {
    expect(validateTopicNameFormat('{group.name}')).toMatch(/\{agent\.name\}/)
  })

  test('rejects an empty format', () => {
    expect(validateTopicNameFormat('   ')).toMatch(/empty/i)
  })
})

describe('topicNameFor with a group template', () => {
  test('explicit format wins over the default-group bare-name rule', () => {
    const name = topicNameFor(
      { name: 'researcher' },
      {
        id: DEFAULT_GROUP_ID,
        name: 'default',
        telegramTopicNameFormat: '{group.slug}:{agent.name}',
      },
    )
    expect(name).toBe('default:researcher')
  })

  test('explicit format wins over the slug-arrow rule', () => {
    const name = topicNameFor(
      { name: 'coder' },
      {
        id: 'home-reno',
        name: 'Home Reno',
        telegramTopicNameFormat: '{group.name} / {agent.name}',
      },
    )
    expect(name).toBe('Home Reno / coder')
  })

  test('null format falls back to built-in naming', () => {
    expect(
      topicNameFor({ name: 'x' }, { id: 'work', name: 'Work', telegramTopicNameFormat: null }),
    ).toBe('work › x')
  })
})

describe('groupRepo telegram_topic_name_format round-trip', () => {
  let env: TestEnv
  beforeEach(() => {
    env = makeTestEnv()
  })
  afterEach(() => env.cleanup())

  test('defaults to null and survives set + clear', () => {
    registerGroup(env.db, { id: 'g', name: 'G' }, env.paths)
    expect(groupRepo.get(env.db, 'g', env.paths)?.telegramTopicNameFormat).toBeNull()

    groupRepo.setTelegramTopicNameFormat(env.db, 'g', '{group.name} / {agent.name}')
    expect(groupRepo.get(env.db, 'g', env.paths)?.telegramTopicNameFormat).toBe(
      '{group.name} / {agent.name}',
    )

    groupRepo.setTelegramTopicNameFormat(env.db, 'g', null)
    expect(groupRepo.get(env.db, 'g', env.paths)?.telegramTopicNameFormat).toBeNull()
  })
})
