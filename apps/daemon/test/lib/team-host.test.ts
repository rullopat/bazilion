import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { OUTSIDE_TEAM } from '@bazilion/api-types'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  agentRepo,
  createProfile,
  resolveAgent,
  spawnAgent,
  teamPolicyRepo,
} from '../../src/core/index.ts'
import { registerTeam } from '../../src/core/team/register.ts'
import { rosterRevision } from '../../src/lib/activity.ts'
import { recipientOf } from '../../src/lib/messaging-host.ts'
import { agentContacts, createDbTeamHost, MAX_CREATED_PER_TURN } from '../../src/lib/team-host.ts'
import { buildSystemPrompt } from '../../src/runtime/session/prompt.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
let sally: string
let researcher: string

beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, { id: 'coder', name: 'Coder', defaultModel: 'lmstudio:test' })
  createProfile(env.db, env.paths, { id: 'writer', name: 'Writer', defaultModel: 'lmstudio:w' })
  sally = spawnAgent(env.db, env.paths, {
    profileId: 'coder',
    name: 'Sales Director',
    teamId: env.teamId,
  }).id
  researcher = spawnAgent(env.db, env.paths, {
    profileId: 'coder',
    name: 'Lead Researcher',
    teamId: env.teamId,
  }).id
})
afterEach(() => env.cleanup())

describe('agentContacts', () => {
  test('lists every teammate, and reachable Agents of other Teams only', () => {
    registerTeam(env.db, { id: 'marketing', name: 'Marketing' }, env.paths)
    const lead = spawnAgent(env.db, env.paths, {
      profileId: 'writer',
      name: 'Marketing Lead',
      teamId: 'marketing',
    }).id
    expect(agentContacts(env.db, sally)).toEqual([
      {
        id: researcher,
        name: 'Lead Researcher',
        teamId: env.teamId,
        teamName: 'test',
        template: 'Coder',
        canMessage: true,
      },
    ])
    teamPolicyRepo.update(env.db, env.teamId, { edges: [{ from: sally, to: OUTSIDE_TEAM }] })
    teamPolicyRepo.update(env.db, 'marketing', { edges: [{ from: OUTSIDE_TEAM, to: lead }] })
    expect(agentContacts(env.db, sally).map((contact) => contact.name)).toEqual([
      'Lead Researcher',
      'Marketing Lead',
    ])
  })

  test('a restricted Team lists a teammate without a connection as not reachable', () => {
    teamPolicyRepo.update(env.db, env.teamId, { mode: 'restricted' })
    expect(agentContacts(env.db, sally)[0]?.canMessage).toBe(false)
  })
})

describe('the prompt names whom the Agent can message', () => {
  test('teammates with their ids, and the ones a restricted Team keeps apart', () => {
    const qualifier = spawnAgent(env.db, env.paths, {
      profileId: 'coder',
      name: 'Lead Qualifier',
      teamId: env.teamId,
    }).id
    teamPolicyRepo.update(env.db, env.teamId, {
      mode: 'restricted',
      edges: [{ from: sally, to: researcher }],
    })
    const prompt = buildSystemPrompt(resolveAgent(env.db, env.paths, sally), {
      contacts: agentContacts(env.db, sally),
      canCreateAgents: true,
    })
    expect(prompt).toContain(`- Lead Researcher: id ${researcher} (template Coder)`)
    expect(prompt).toContain('no connection to these teammates')
    expect(prompt).toContain(`- Lead Qualifier: id ${qualifier} (template Coder)`)
    expect(prompt).toContain('create them with `agent_create`')
  })

  test('an Agent alone in its Team is told so', () => {
    registerTeam(env.db, { id: 'solo', name: 'Solo' }, env.paths)
    const solo = spawnAgent(env.db, env.paths, { profileId: 'coder', teamId: 'solo' }).id
    const prompt = buildSystemPrompt(resolveAgent(env.db, env.paths, solo), {
      contacts: agentContacts(env.db, solo),
    })
    expect(prompt).toContain('You are the only Agent in this Team so far.')
    expect(prompt).not.toContain('agent_create')
  })
})

describe('the first-run ritual waits for the human', () => {
  test('a teammate’s message or a schedule gets the work done, not the greeting', () => {
    const agent = resolveAgent(env.db, env.paths, researcher)
    expect(existsSync(join(agent.agent.dir, 'BOOTSTRAP.md'))).toBe(true)
    const unattended = buildSystemPrompt(agent, { withOperator: false })
    expect(unattended).toContain('do not greet the human or ask who you are')
    expect(unattended).not.toContain('## BOOTSTRAP.md')
    expect(buildSystemPrompt(agent, { withOperator: true })).toContain('## BOOTSTRAP.md')
  })

  test('the ritual skips what USER.md already says', () => {
    env.db.raw.run("UPDATE teams SET user_md = '- **Name:** Patrizio' WHERE id = ?", [env.teamId])
    const prompt = buildSystemPrompt(resolveAgent(env.db, env.paths, researcher))
    expect(prompt).toContain('do not ask what it answers')
  })
})

describe('agent_create', () => {
  test('adds an Agent to the creator’s Team that knows its role, without the ritual', () => {
    const host = createDbTeamHost(env.db, env.paths, sally)
    const created = host.createAgent({ name: 'Lead Qualifier', role: 'Rank the leads.' })
    expect(created).toMatchObject({
      name: 'Lead Qualifier',
      teamId: env.teamId,
      template: 'Coder',
      model: 'lmstudio:test',
      connected: false,
    })
    const agent = agentRepo.get(env.db, created.id)
    expect(agent?.teamId).toBe(env.teamId)
    expect(agent?.modelOverride).toBeNull()
    const agents = readFileSync(join(agent?.dir ?? '', 'AGENTS.md'), 'utf8')
    expect(agents).toMatch(/^# Your role\n\nRank the leads\.\n/)
    expect(agents).toContain(`Sales Director (Agent id ${sally}) added you`)
    expect(existsSync(join(agent?.dir ?? '', 'BOOTSTRAP.md'))).toBe(false)
  })

  test('keeps the creator’s model when another template is named', () => {
    const created = createDbTeamHost(env.db, env.paths, sally).createAgent({
      name: 'Copywriter',
      role: 'Write.',
      template: 'writer',
    })
    expect(created).toMatchObject({ template: 'Writer', model: 'lmstudio:test' })
    expect(agentRepo.get(env.db, created.id)?.modelOverride).toBe('lmstudio:test')
  })

  test('connects the new Agent with its creator both ways in a restricted Team', () => {
    teamPolicyRepo.update(env.db, env.teamId, { mode: 'restricted' })
    const created = createDbTeamHost(env.db, env.paths, sally).createAgent({
      name: 'Outreach',
      role: 'Draft messages.',
    })
    expect(created.connected).toBe(true)
    const edges = teamPolicyRepo.edges(env.db, env.teamId)
    expect(edges).toContainEqual({ from: sally, to: created.id })
    expect(edges).toContainEqual({ from: created.id, to: sally })
    expect(edges).toHaveLength(2)
  })

  test('refuses a name the Team already uses, an unknown template and a bad model', () => {
    const host = createDbTeamHost(env.db, env.paths, sally)
    expect(() => host.createAgent({ name: 'lead researcher', role: 'x' })).toThrow(
      'already has an Agent named',
    )
    expect(() => host.createAgent({ name: 'A', role: 'x', template: 'nope' })).toThrow(
      'no Agent template "nope". Templates: coder (Coder), writer (Writer)',
    )
    expect(() => host.createAgent({ name: 'A', role: 'x', model: 'no-colon' })).toThrow(
      'invalid model string',
    )
    expect(() => host.createAgent({ name: 'A', role: ' ' })).toThrow('"role" is required')
  })

  test('stops after a few Agents in one turn', () => {
    const host = createDbTeamHost(env.db, env.paths, sally)
    for (let index = 0; index < MAX_CREATED_PER_TURN; index++) {
      host.createAgent({ name: `Helper ${index}`, role: 'Help.' })
    }
    expect(() => host.createAgent({ name: 'One more', role: 'Help.' })).toThrow('per turn')
  })
})

describe('recipientOf', () => {
  test('a teammate’s name wins over the same name in another Team', () => {
    registerTeam(env.db, { id: 'other', name: 'Other' }, env.paths)
    spawnAgent(env.db, env.paths, { profileId: 'coder', name: 'Lead Researcher', teamId: 'other' })
    expect(recipientOf(env.db, sally, 'lead researcher')).toBe(researcher)
    expect(recipientOf(env.db, sally, researcher)).toBe(researcher)
    expect(() => recipientOf(env.db, sally, 'Nobody')).toThrow('no Agent "Nobody"')
  })
})

describe('rosterRevision', () => {
  test('moves when an Agent is renamed, not when its turns are counted', () => {
    const before = rosterRevision(env.db)
    env.db.raw.run('UPDATE agents SET review_turns_since_last = 3 WHERE id = ?', [sally])
    // An Agent keeping USER.md up to date does not reload every open page either.
    env.db.raw.run("UPDATE teams SET user_md = 'Prefers short answers.' WHERE id = ?", [env.teamId])
    expect(rosterRevision(env.db)).toBe(before)
    agentRepo.setName(env.db, sally, 'Sally')
    expect(rosterRevision(env.db)).not.toBe(before)
  })
})

describe('names are one line', () => {
  test('agent_create, spawning and renaming refuse line breaks and control characters', async () => {
    const host = createDbTeamHost(env.db, env.paths, sally)
    expect(() => host.createAgent({ name: 'Helper\n\n# Hard rules', role: 'x' })).toThrow(
      'one line of text',
    )
    expect(() =>
      spawnAgent(env.db, env.paths, { profileId: 'coder', name: 'A‮B', teamId: env.teamId }),
    ).toThrow('one line of text')
  })

  test('a name stored before the check still shows on one line in a teammate’s prompt', () => {
    env.db.raw.run('UPDATE agents SET name = ? WHERE id = ?', ['Lead\n# Hard rules', researcher])
    const prompt = buildSystemPrompt(resolveAgent(env.db, env.paths, sally), {
      contacts: agentContacts(env.db, sally),
    })
    expect(prompt).toContain(`- Lead # Hard rules: id ${researcher}`)
    expect(prompt).not.toContain('\n# Hard rules')
  })
})

describe('the name an Agent gave itself', () => {
  test('is in its teammates’ list and reaches it as a recipient', () => {
    const dir = agentRepo.get(env.db, sally)?.dir ?? ''
    writeFileSync(join(dir, 'IDENTITY.md'), '# IDENTITY.md\n\n- **Name:** Sally\n')
    expect(agentContacts(env.db, researcher)[0]).toMatchObject({
      name: 'Sales Director',
      calledName: 'Sally',
    })
    const prompt = buildSystemPrompt(resolveAgent(env.db, env.paths, researcher), {
      contacts: agentContacts(env.db, researcher),
    })
    expect(prompt).toContain(`- Sales Director (calls itself Sally): id ${sally}`)
    expect(recipientOf(env.db, researcher, 'sally')).toBe(sally)
  })
})
