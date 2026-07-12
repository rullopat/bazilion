// Agent name resolver tests — pure parsing + DB lookup, no Telegram surface.

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import { registerTeam } from '../../src/core/team/register.ts'
import {
  parseAgentRef,
  parseAndResolveAgent,
  resolveAgentRef,
} from '../../src/lib/telegram/resolve-agent.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
beforeEach(() => {
  env = makeTestEnv()
  // Seed a profile every test — agents need one to spawn.
  createProfile(env.db, env.paths, {
    id: 'base',
    defaultModel: 'anthropic:claude-opus-4-6',
    defaultSkills: [],
  })
})
afterEach(() => env.cleanup())

describe('parseAgentRef', () => {
  test('bare name', () => {
    expect(parseAgentRef('researcher')).toEqual({ teamId: null, name: 'researcher' })
  })

  test('qualified team/name', () => {
    expect(parseAgentRef('home-reno/researcher')).toEqual({
      teamId: 'home-reno',
      name: 'researcher',
    })
  })

  test('trims surrounding whitespace', () => {
    expect(parseAgentRef('  researcher  ')).toEqual({ teamId: null, name: 'researcher' })
  })

  test('quoted name with spaces', () => {
    expect(parseAgentRef('"Patrizio\'s Coder"')).toEqual({
      teamId: null,
      name: "Patrizio's Coder",
    })
  })

  test('empty string returns null', () => {
    expect(parseAgentRef('')).toBeNull()
    expect(parseAgentRef('  ')).toBeNull()
  })

  test('slash-only or partial returns null', () => {
    expect(parseAgentRef('/')).toBeNull()
    expect(parseAgentRef('team/')).toBeNull()
    expect(parseAgentRef('/name')).toBeNull()
  })
})

describe('resolveAgentRef', () => {
  test('bare name with one matching agent returns ok', () => {
    spawnAgent(env.db, env.paths, {
      profileId: 'base',
      teamId: env.teamId,
      name: 'researcher',
    })
    const r = resolveAgentRef(env.db, { teamId: null, name: 'researcher' })
    expect(r.kind).toBe('ok')
  })

  test('bare name with multiple matches across teams returns ambiguous', () => {
    registerTeam(env.db, { id: 'g2', name: 'g2' }, env.paths)
    spawnAgent(env.db, env.paths, {
      profileId: 'base',
      teamId: env.teamId,
      name: 'researcher',
    })
    spawnAgent(env.db, env.paths, { profileId: 'base', teamId: 'g2', name: 'researcher' })
    const r = resolveAgentRef(env.db, { teamId: null, name: 'researcher' })
    expect(r.kind).toBe('ambiguous')
    if (r.kind === 'ambiguous') {
      expect(r.matches).toHaveLength(2)
    }
  })

  test('bare name with no matches returns not-found', () => {
    const r = resolveAgentRef(env.db, { teamId: null, name: 'nobody' })
    expect(r.kind).toBe('not-found')
  })

  test('qualified name resolves to the agent in that specific team', () => {
    registerTeam(env.db, { id: 'g2', name: 'g2' }, env.paths)
    spawnAgent(env.db, env.paths, {
      profileId: 'base',
      teamId: env.teamId,
      name: 'researcher',
    })
    spawnAgent(env.db, env.paths, { profileId: 'base', teamId: 'g2', name: 'researcher' })

    const r1 = resolveAgentRef(env.db, { teamId: env.teamId, name: 'researcher' })
    expect(r1.kind).toBe('ok')
    if (r1.kind === 'ok') expect(r1.agent.teamId).toBe(env.teamId)

    const r2 = resolveAgentRef(env.db, { teamId: 'g2', name: 'researcher' })
    expect(r2.kind).toBe('ok')
    if (r2.kind === 'ok') expect(r2.agent.teamId).toBe('g2')
  })

  test('qualified name with no match in that team returns not-found', () => {
    spawnAgent(env.db, env.paths, {
      profileId: 'base',
      teamId: env.teamId,
      name: 'researcher',
    })
    const r = resolveAgentRef(env.db, { teamId: 'nope', name: 'researcher' })
    expect(r.kind).toBe('not-found')
  })

  test('archived agents are excluded from matches', () => {
    const agent = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      teamId: env.teamId,
      name: 'researcher',
    })
    // Archive via direct repo update — simulates `agent archive`.
    env.db.raw.run('UPDATE agents SET status = ? WHERE id = ?', ['archived', agent.id])

    const r = resolveAgentRef(env.db, { teamId: null, name: 'researcher' })
    expect(r.kind).toBe('not-found')
  })
})

describe('parseAndResolveAgent (composite)', () => {
  test('empty input yields bad-input with usage hint', () => {
    const r = parseAndResolveAgent(env.db, '')
    expect(r.kind).toBe('bad-input')
    if (r.kind === 'bad-input') expect(r.message).toMatch(/usage/i)
  })

  test('happy path: parse + resolve in one call', () => {
    spawnAgent(env.db, env.paths, { profileId: 'base', teamId: env.teamId, name: 'r1' })
    const r = parseAndResolveAgent(env.db, 'r1')
    expect(r.kind).toBe('ok')
  })
})
