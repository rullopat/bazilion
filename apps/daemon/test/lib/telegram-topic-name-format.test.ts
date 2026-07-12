// Per-team topic-name template: rendering, validation, and repo round-trip.

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import * as teamRepo from '../../src/core/repos/teams.ts'
import { registerTeam } from '../../src/core/team/register.ts'
import {
  DEFAULT_TEAM_ID,
  renderTopicNameFormat,
  topicNameFor,
  validateTopicNameFormat,
} from '../../src/lib/telegram/naming.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

describe('renderTopicNameFormat', () => {
  test('substitutes all three tokens', () => {
    const out = renderTopicNameFormat('{team.name} / {agent.name} [{team.slug}]', {
      agentName: 'researcher',
      teamName: 'Home Reno',
      teamSlug: 'home-reno',
    })
    expect(out).toBe('Home Reno / researcher [home-reno]')
  })

  test('repeats a token wherever it appears', () => {
    const out = renderTopicNameFormat('{agent.name}-{agent.name}', {
      agentName: 'a',
      teamName: 'g',
      teamSlug: 'g',
    })
    expect(out).toBe('a-a')
  })
})

describe('validateTopicNameFormat', () => {
  test('accepts a format with known tokens and {agent.name}', () => {
    expect(validateTopicNameFormat('{team.name} / {agent.name}')).toBeNull()
  })

  test('rejects an unknown token', () => {
    expect(validateTopicNameFormat('{agent.name} {agent.emoji}')).toMatch(/unknown token/i)
  })

  test('rejects a format missing {agent.name}', () => {
    expect(validateTopicNameFormat('{team.name}')).toMatch(/\{agent\.name\}/)
  })

  test('rejects an empty format', () => {
    expect(validateTopicNameFormat('   ')).toMatch(/empty/i)
  })
})

describe('topicNameFor with a team template', () => {
  test('explicit format wins over the default-team bare-name rule', () => {
    const name = topicNameFor(
      { name: 'researcher' },
      {
        id: DEFAULT_TEAM_ID,
        name: 'default',
        telegramTopicNameFormat: '{team.slug}:{agent.name}',
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
        telegramTopicNameFormat: '{team.name} / {agent.name}',
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

describe('teamRepo telegram_topic_name_format round-trip', () => {
  let env: TestEnv
  beforeEach(() => {
    env = makeTestEnv()
  })
  afterEach(() => env.cleanup())

  test('defaults to null and survives set + clear', () => {
    registerTeam(env.db, { id: 'g', name: 'G' }, env.paths)
    expect(teamRepo.get(env.db, 'g', env.paths)?.telegramTopicNameFormat).toBeNull()

    teamRepo.setTelegramTopicNameFormat(env.db, 'g', '{team.name} / {agent.name}')
    expect(teamRepo.get(env.db, 'g', env.paths)?.telegramTopicNameFormat).toBe(
      '{team.name} / {agent.name}',
    )

    teamRepo.setTelegramTopicNameFormat(env.db, 'g', null)
    expect(teamRepo.get(env.db, 'g', env.paths)?.telegramTopicNameFormat).toBeNull()
  })
})
