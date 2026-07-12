import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { archiveAgent } from '../../src/core/agent/archive.ts'
import { deleteAgent } from '../../src/core/agent/delete.ts'
import { resolveAgent } from '../../src/core/agent/resolve.ts'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { unarchiveAgent } from '../../src/core/agent/unarchive.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as agentRepo from '../../src/core/repos/agents.ts'
import * as messageRepo from '../../src/core/repos/messages.ts'
import * as teamPolicyRepo from '../../src/core/repos/teamPolicies.ts'
import { registerTeam } from '../../src/core/team/register.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

let env: TestEnv
beforeEach(() => {
  env = makeTestEnv()
})
afterEach(() => env.cleanup())

function seedProfile() {
  return createProfile(env.db, env.paths, {
    id: 'base',
    defaultModel: 'anthropic:claude-opus-4-6',
    defaultSkills: ['skill-a'],
  })
}

function spawn(input: Partial<Parameters<typeof spawnAgent>[2]> & { profileId?: string } = {}) {
  return spawnAgent(env.db, env.paths, {
    profileId: input.profileId ?? 'base',
    teamId: input.teamId ?? env.teamId,
    teamExpectedRevision:
      input.teamExpectedRevision ??
      teamPolicyRepo.get(env.db, input.teamId ?? env.teamId)?.revision,
    placement: input.placement ?? 'open',
    ...input,
  })
}

test('spawnAgent creates dir, copies templates, inserts row, attaches default skills', () => {
  seedProfile()
  const agent = spawn({ name: 'A1' })

  expect(agent.profileId).toBe('base')
  expect(agent.status).toBe('idle')
  expect(agent.teamId).toBe(env.teamId)
  expect(existsSync(agent.dir)).toBe(true)
  expect(existsSync(join(agent.dir, 'SOUL.md'))).toBe(true)
  expect(existsSync(join(agent.dir, 'IDENTITY.md'))).toBe(true)
  expect(existsSync(join(agent.dir, 'BOOTSTRAP.md'))).toBe(true)
  expect(existsSync(join(agent.dir, 'agent.json'))).toBe(true)
  // Memory now lives at the team level (`teams/<slug>/memory/`), shared
  // by all member agents. The agent's private home only carries identity
  // files + sessions/.
  expect(existsSync(join(agent.dir, 'sessions'))).toBe(true)
  expect(existsSync(join(agent.dir, 'memory'))).toBe(false)

  expect(agentRepo.listAttachedSkills(env.db, agent.id)).toEqual(['skill-a'])
})

test('a fresh spawn from a default-template profile has the default-on files (HEARTBEAT opt-in)', () => {
  seedProfile() // no template overrides → default-on set
  const agent = spawn({ name: 'five' })
  for (const file of ['SOUL.md', 'IDENTITY.md', 'BOOTSTRAP.md', 'AGENTS.md', 'TOOLS.md']) {
    expect(existsSync(join(agent.dir, file))).toBe(true)
  }
  // HEARTBEAT is opt-in — not seeded by the default profile.
  expect(existsSync(join(agent.dir, 'HEARTBEAT.md'))).toBe(false)
})

test('resolveAgent surfaces parsed identity from the agent IDENTITY.md', () => {
  seedProfile()
  const agent = spawn({ name: 'idtest' })

  // Freshly spawned: IDENTITY.md still holds placeholder template → null.
  expect(resolveAgent(env.db, env.paths, agent.id).agent.identity).toBeNull()

  // Agent fills it in (as it would via home_write during bootstrap).
  writeFileSync(
    join(agent.dir, 'IDENTITY.md'),
    '- **Name:** Sable\n- **Creature:** house spirit\n- **Avatar:** https://example.com/s.png\n',
  )
  expect(resolveAgent(env.db, env.paths, agent.id).agent.identity).toEqual({
    name: 'Sable',
    creature: 'house spirit',
    avatar: 'https://example.com/s.png',
  })
})

test('backwards-compat: an old 3-field placeholder IDENTITY.md resolves to null identity', () => {
  seedProfile()
  const agent = spawn({ name: 'legacy' })
  // The old 3-field template: Name/Vibe/Emoji with empty values.
  writeFileSync(
    join(agent.dir, 'IDENTITY.md'),
    '# IDENTITY.md — Who Am I?\n\n- **Name:**\n- **Vibe:**\n- **Emoji:**\n',
  )
  expect(resolveAgent(env.db, env.paths, agent.id).agent.identity).toBeNull()
})

test('spawnAgent copies optional AGENTS/TOOLS/HEARTBEAT files when the profile seeded them', () => {
  createProfile(env.db, env.paths, {
    id: 'felix',
    defaultModel: 'm',
    templates: {
      agents: '# AGENTS\n- peer: hello\n',
      tools: '# TOOLS\n- ripgrep before grep\n',
      heartbeat: '# HEARTBEAT\n- check calendar\n',
    },
  })
  const agent = spawn({ profileId: 'felix' })
  expect(existsSync(join(agent.dir, 'AGENTS.md'))).toBe(true)
  expect(existsSync(join(agent.dir, 'TOOLS.md'))).toBe(true)
  expect(existsSync(join(agent.dir, 'HEARTBEAT.md'))).toBe(true)
})

test('spawnAgent does not create optional AGENTS/TOOLS/HEARTBEAT files when the profile lacks them', () => {
  // These files default ON, so a profile that lacks them must opt out
  // with null. spawn must not fabricate files the profile doesn't have.
  createProfile(env.db, env.paths, {
    id: 'no-optionals',
    defaultModel: 'anthropic:claude-opus-4-6',
    templates: { agents: null, tools: null, heartbeat: null },
  })
  const agent = spawn({ profileId: 'no-optionals' })
  expect(existsSync(join(agent.dir, 'AGENTS.md'))).toBe(false)
  expect(existsSync(join(agent.dir, 'TOOLS.md'))).toBe(false)
  expect(existsSync(join(agent.dir, 'HEARTBEAT.md'))).toBe(false)
})

test('spawning many agents from one profile produces independent instances', () => {
  seedProfile()
  const a = spawn()
  const b = spawn()
  expect(a.id).not.toBe(b.id)
  expect(a.dir).not.toBe(b.dir)
  expect(agentRepo.list(env.db).length).toBe(2)
})

test('spawnAgent places the agent in the requested team', () => {
  seedProfile()
  const g = registerTeam(env.db, { id: 'extra' }, env.paths)

  const agent = spawn({ teamId: g.id })
  expect(agent.teamId).toBe('extra')
})

test('spawnAgent rejects an unknown team', () => {
  seedProfile()
  expect(() => spawn({ teamId: 'no-such-team' })).toThrow(/team "no-such-team" does not exist/)
})

test('agentRepo.setGroup moves an agent to a different team', () => {
  seedProfile()
  const g2 = registerTeam(env.db, { id: 'g2' }, env.paths)
  const agent = spawn()
  expect(agent.teamId).toBe(env.teamId)

  agentRepo.setGroup(env.db, agent.id, g2.id)
  expect(agentRepo.get(env.db, agent.id)?.teamId).toBe('g2')
})

test('attaching and detaching skills on the fly', () => {
  seedProfile()
  const agent = spawn()

  agentRepo.attachSkill(env.db, agent.id, 'extra')
  expect(agentRepo.listAttachedSkills(env.db, agent.id).sort()).toEqual(['extra', 'skill-a'])

  agentRepo.detachSkill(env.db, agent.id, 'skill-a')
  expect(agentRepo.listAttachedSkills(env.db, agent.id)).toEqual(['extra'])
})

test('archiveAgent sets status and timestamp', () => {
  seedProfile()
  const agent = spawn()
  archiveAgent(env.db, agent.id)
  const after = agentRepo.get(env.db, agent.id)
  expect(after?.status).toBe('archived')
  expect(after?.archivedAt).not.toBeNull()
})

test('list excludes archived by default', () => {
  seedProfile()
  const a = spawn()
  spawn()
  archiveAgent(env.db, a.id)

  expect(agentRepo.list(env.db).length).toBe(1)
  expect(agentRepo.list(env.db, { includeArchived: true }).length).toBe(2)
})

test('unarchiveAgent flips status back to idle and clears archivedAt', () => {
  seedProfile()
  const agent = spawn()
  archiveAgent(env.db, agent.id)
  expect(agentRepo.get(env.db, agent.id)?.status).toBe('archived')

  unarchiveAgent(env.db, agent.id)
  const after = agentRepo.get(env.db, agent.id)
  expect(after?.status).toBe('idle')
  expect(after?.archivedAt).toBeNull()
})

test('unarchiveAgent throws on a non-archived agent', () => {
  seedProfile()
  const agent = spawn()
  expect(() => unarchiveAgent(env.db, agent.id)).toThrow(/not archived/)
})

test('unarchiveAgent throws on an unknown id', () => {
  seedProfile()
  expect(() => unarchiveAgent(env.db, 'ghost-id')).toThrow()
})

test('deleteAgent removes the DB row and the on-disk directory', () => {
  seedProfile()
  const agent = spawn()
  expect(existsSync(agent.dir)).toBe(true)

  deleteAgent(env.db, agent.id, teamPolicyRepo.get(env.db, env.teamId)?.revision ?? 0)
  expect(agentRepo.get(env.db, agent.id)).toBeNull()
  expect(existsSync(agent.dir)).toBe(false)
})

test('deleteAgent cascades to attachments, messages, runs', () => {
  seedProfile()
  const a = spawn()
  const b = spawn()
  agentRepo.attachSkill(env.db, a.id, 'extra')

  // Side table: a message tied to the agent
  messageRepo.send(env.db, {
    from: b.id,
    to: a.id,
    payload: JSON.stringify({ text: 'hi' }),
  })

  // Sanity: the rows exist before delete
  expect(agentRepo.listAttachedSkills(env.db, a.id).length).toBeGreaterThan(0)
  expect(messageRepo.listInbox(env.db, a.id).length).toBe(1)

  deleteAgent(env.db, a.id, teamPolicyRepo.get(env.db, env.teamId)?.revision ?? 0)

  expect(agentRepo.get(env.db, a.id)).toBeNull()
  expect(agentRepo.listAttachedSkills(env.db, a.id)).toEqual([])
  expect(messageRepo.listInbox(env.db, a.id)).toEqual([])

  // Agent b is untouched
  expect(agentRepo.get(env.db, b.id)).not.toBeNull()
})

test('deleteAgent throws on an unknown id', () => {
  seedProfile()
  expect(() => deleteAgent(env.db, 'ghost-id', 1)).toThrow()
})

test('agentRepo.get resolves an unambiguous UUID prefix (≥4 chars)', () => {
  seedProfile()
  const agent = spawn()
  // Full UUID still works
  expect(agentRepo.get(env.db, agent.id)?.id).toBe(agent.id)
  // First 8 chars (git-style) resolves
  const prefix = agent.id.slice(0, 8)
  expect(agentRepo.get(env.db, prefix)?.id).toBe(agent.id)
  // <4 chars never resolves
  expect(agentRepo.get(env.db, agent.id.slice(0, 3))).toBeNull()
  // Non-existing prefix still null
  expect(agentRepo.get(env.db, 'zzzzzzzz')).toBeNull()
})

test('agentRepo.get resolves by exact name when unique', () => {
  seedProfile()
  const a = spawn({ name: 'alpha' })
  const b = spawn({ name: 'beta' })

  expect(agentRepo.get(env.db, 'alpha')?.id).toBe(a.id)
  expect(agentRepo.get(env.db, 'beta')?.id).toBe(b.id)
  expect(agentRepo.get(env.db, 'nobody')).toBeNull()
})

test('agentRepo.get returns null for an ambiguous name', () => {
  seedProfile()
  spawn({ name: 'twin' })
  spawn({ name: 'twin' })
  expect(agentRepo.get(env.db, 'twin')).toBeNull()
})

test('agentRepo.get prefers exact name over prefix collision', () => {
  seedProfile()
  // An agent whose name is a hex string that is ALSO a valid UUID prefix of
  // some other agent's id. The name-match should win so users can rename
  // agents to anything and have lookup behave predictably.
  const id = 'deadbeef-0000-0000-0000-000000000000'
  agentRepo.insert(env.db, {
    id,
    profileId: 'base',
    name: 'A-with-hex-prefix-name',
    modelOverride: null,
    reasoningLevel: 'medium',
    status: 'idle',
    dir: '/tmp/none-hex',
    teamId: env.teamId,
  })
  const b = spawn({ name: 'deadbeef' })

  // Lookup "deadbeef": exact name on agent b wins, even though it matches a
  // (the id starts with deadbeef).
  expect(agentRepo.get(env.db, 'deadbeef')?.id).toBe(b.id)
  // But the full id for a still resolves
  expect(agentRepo.get(env.db, id)?.id).toBe(id)
})

test('agentRepo.get returns null for ambiguous prefix', () => {
  seedProfile()
  // Insert two agents manually with IDs that share a 4-char prefix; spawnAgent
  // uses random UUIDs so we bypass it.
  agentRepo.insert(env.db, {
    id: 'abcd1111-aaaa-bbbb-cccc-dddddddddddd',
    profileId: 'base',
    name: 'A',
    modelOverride: null,
    reasoningLevel: 'medium',
    status: 'idle',
    dir: '/tmp/none-a',
    teamId: env.teamId,
  })
  agentRepo.insert(env.db, {
    id: 'abcd2222-aaaa-bbbb-cccc-dddddddddddd',
    profileId: 'base',
    name: 'B',
    modelOverride: null,
    reasoningLevel: 'medium',
    status: 'idle',
    dir: '/tmp/none-b',
    teamId: env.teamId,
  })
  expect(agentRepo.get(env.db, 'abcd')).toBeNull() // ambiguous
  expect(agentRepo.get(env.db, 'abcd1')?.name).toBe('A') // unique
  expect(agentRepo.get(env.db, 'abcd2')?.name).toBe('B')
})

test('resolveAgent accepts a UUID prefix', () => {
  seedProfile()
  const agent = spawn()
  const resolved = resolveAgent(env.db, env.paths, agent.id.slice(0, 8))
  expect(resolved.agent.id).toBe(agent.id)
})

test('resolveAgent assembles profile, skills, team, and model', () => {
  seedProfile()
  const g = registerTeam(env.db, { id: 'rg' }, env.paths)
  const agent = spawn({ teamId: g.id, modelOverride: 'openai:gpt-5' })

  const resolved = resolveAgent(env.db, env.paths, agent.id)
  expect(resolved.model).toBe('openai:gpt-5')
  expect(resolved.profile.id).toBe('base')
  expect(resolved.team.id).toBe('rg')
  // New teams seed the starter USER.md instead of starting blank.
  expect(resolved.team.userMd).toContain('About Your Human')
  expect(resolved.skills).toEqual(['skill-a'])
})

test('resolveAgent uses profile default model when no override', () => {
  seedProfile()
  const agent = spawn()
  const resolved = resolveAgent(env.db, env.paths, agent.id)
  expect(resolved.model).toBe('anthropic:claude-opus-4-6')
})
