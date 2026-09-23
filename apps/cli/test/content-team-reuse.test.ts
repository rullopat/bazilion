import { join } from 'node:path'
import type { Agent, ResultListResponse } from '@bazilion/api-types'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { type MockLlm, startLmStudioMock } from './fixtures/mock-lmstudio.ts'
import { restartTestServer, startTestServer, type TestServer } from './server-fixture.ts'

// CT-17 D-lane slice plus composed restart retention. Two Teams from the same
// template run two independently selected topics; the canned models make the
// isolation observable (results, messaging, no cross-Team delivery). This is
// plumbing evidence for recipe reuse, not model judgment about topics.
const recipe = join(import.meta.dirname, '../../../examples/content-team')
const roles = ['coordinator', 'researcher', 'writer', 'designer'] as const

let mock: MockLlm
let server: TestServer
const daemonEnv = {
  LMSTUDIO_URL: '', // set in beforeAll once the mock listens
  BAZILION_TEAM_POLICY_ENFORCEMENT: 'on',
  BAZILION_SCHEDULER: 'off',
  BAZILION_IMAGE_GENERATION: 'off',
}
const agentsByTeam = new Map<string, Map<(typeof roles)[number], Agent>>()
const teams = ['content-a', 'content-b'] as const

function agent(team: (typeof teams)[number], role: (typeof roles)[number]): string {
  const id = agentsByTeam.get(team)?.get(role)?.id
  if (!id) throw new Error(`missing agent ${team}/${role}`)
  return id
}

beforeAll(async () => {
  mock = await startLmStudioMock()
  daemonEnv.LMSTUDIO_URL = mock.url
  server = await startTestServer(daemonEnv)
  await server.cli(['skill', 'import', '--from', `${recipe}/skills`])
  for (const role of roles) {
    const created = await server.cli([
      'profile',
      'create',
      `content-${role}`,
      '--model',
      'lmstudio:test-model',
      '--skills-mode',
      'selected',
      '--skills',
      'content-preparation',
      '--skip-bootstrap',
      '--soul-file',
      `${recipe}/profiles/${role}.md`,
      '--agents-file',
      `${recipe}/operating-rules.md`,
      '--tools-file',
      `${recipe}/tools.md`,
    ])
    expect(created.exitCode, created.stderr).toBe(0)
  }
  await server.cli(['team-template', 'import', `${recipe}/team-template.json`, '--apply'])
  for (const team of teams) {
    const response = await fetch(`${server.url}/api/team-templates/content-preparation/spawn`, {
      method: 'POST',
      headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ templateExpectedRevision: 1, teamId: team, mode: 'initialize' }),
    })
    expect(response.status).toBe(201)
    const spawned = (await response.json()) as { agents: Agent[] }
    agentsByTeam.set(
      team,
      new Map(
        spawned.agents.map((a) => {
          const role = roles.find((r) => a.profileId === `content-${r}`)
          if (!role) throw new Error(`unexpected profile ${a.profileId}`)
          return [role, a] as const
        }),
      ),
    )
  }
}, 60_000)

afterAll(async () => {
  await server.stop()
  await mock.stop()
})

function reply(content: string) {
  return {
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
  }
}

function toolCall(name: string, args: unknown) {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: `call-${name}-${Math.random().toString(36).slice(2, 6)}`,
              type: 'function',
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
  }
}

async function chat(agentId: string, message: string): Promise<string> {
  const result = await server.cli(['agent', 'chat', agentId, '--message', message])
  expect(result.exitCode, result.stderr || result.stdout).toBe(0)
  return result.stdout
}

async function results(team: string): Promise<ResultListResponse> {
  const response = await fetch(`${server.url}/api/results?teamId=${team}`, {
    headers: { authorization: `Bearer ${server.token}` },
  })
  expect(response.status).toBe(200)
  return (await response.json()) as ResultListResponse
}

const briefs: Record<(typeof teams)[number], { file: string; topic: string }> = {
  'content-a': {
    file: 'handoff-a.md',
    topic: 'TOPIC_A: community garden open day',
  },
  'content-b': {
    file: 'handoff-b.md',
    topic: 'TOPIC_B: library seed exchange',
  },
}

async function runCycle(team: (typeof teams)[number]): Promise<void> {
  const brief = briefs[team]
  const deliver = [
    toolCall('write', { path: brief.file, content: `# ${brief.topic}\n` }),
    reply('HANDOFF_READY'),
  ]
  mock.push(deliver)
  await chat(agent(team, 'coordinator'), `New cycle for ${brief.topic}: prepare the handoff.`)
  mock.push([toolCall('deliver_file', { path: brief.file }), reply('DELIVERED')])
  await chat(agent(team, 'coordinator'), 'Deliver it.')
}

test('two Teams reuse the recipe with isolated briefs, results and messaging', async () => {
  await runCycle('content-a')
  await runCycle('content-b')

  const a = await results('content-a')
  const b = await results('content-b')
  expect(a.results.map((r) => r.name)).toEqual([briefs['content-a'].file])
  expect(b.results.map((r) => r.name)).toEqual([briefs['content-b'].file])

  // Cross-Team delivery through the operator route stays denied both ways.
  for (const [from, to] of [
    [agent('content-a', 'coordinator'), agent('content-b', 'researcher')],
    [agent('content-b', 'researcher'), agent('content-a', 'coordinator')],
  ]) {
    const denied = await fetch(`${server.url}/api/agents/${to}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, payload: { text: 'Cross-team handoff attempt.' } }),
    })
    expect(denied.status).toBe(403)
  }
})

test('both Teams handoffs survive a daemon restart with identical hashes', async () => {
  const before = new Map<string, string>()
  for (const team of teams) {
    const list = await results(team)
    for (const result of list.results) before.set(result.id, result.sha256)
  }
  expect(before.size).toBe(2)

  await server.stop({ keepHome: true })
  server = await restartTestServer(server, daemonEnv)

  for (const team of teams) {
    const list = await results(team)
    expect(list.results).toHaveLength(1)
    const result = list.results[0]
    if (!result) throw new Error(`missing retained result for ${team}`)
    expect(result.sha256).toBe(before.get(result.id))
  }
})
