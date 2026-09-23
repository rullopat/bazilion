import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Agent, ListInboxResponse, Message } from '@bazilion/api-types'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { type MockLlm, startLmStudioMock } from './fixtures/mock-lmstudio.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

// First composed BAZ-064 slice: real daemon, real coordinator turn, real specialist
// delivery. The model is canned, so this proves the plumbing (policy, messaging,
// inbox), NOT model judgment, research quality or the composed CT acceptance journey.
// Discovery stays blocked (BAZ-067); image generation stays off; nothing is published.
const recipe = join(import.meta.dirname, '../../../examples/content-team')
const templatePath = join(recipe, 'team-template.json')
const roles = ['coordinator', 'researcher', 'writer', 'designer'] as const
let mock: MockLlm
let server: TestServer
let agents: Map<(typeof roles)[number], Agent>

async function api<T>(path: string, body?: unknown, expectedStatus = 200): Promise<T> {
  const response = await fetch(`${server.url}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      authorization: `Bearer ${server.token}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  expect(response.status, `${path}: ${text}`).toBe(expectedStatus)
  return JSON.parse(text) as T
}

function agentId(role: (typeof roles)[number]): string {
  const agent = agents.get(role)
  if (!agent) throw new Error(`missing spawned role: ${role}`)
  return agent.id
}

beforeAll(async () => {
  mock = await startLmStudioMock()
  server = await startTestServer({
    BAZILION_TEAM_POLICY_ENFORCEMENT: 'on',
    BAZILION_SCHEDULER: 'off',
    BAZILION_IMAGE_GENERATION: 'off',
    LMSTUDIO_URL: mock.url,
  })
  await server.cli(['skill', 'import', '--from', join(recipe, 'skills')])
  for (const role of roles) {
    await server.cli([
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
      join(recipe, 'profiles', `${role}.md`),
      '--agents-file',
      join(recipe, 'operating-rules.md'),
      '--tools-file',
      join(recipe, 'tools.md'),
    ])
  }
  await server.cli(['team-template', 'import', templatePath, '--apply'])
  const spawned = await api<{ agents: Agent[] }>(
    '/api/team-templates/content-preparation/spawn',
    { templateExpectedRevision: 1, teamId: 'content-first', mode: 'initialize' },
    201,
  )
  agents = new Map(
    spawned.agents.map((agent) => {
      const role = roles.find((r) => agent.profileId === `content-${r}`)
      if (!role) throw new Error(`unexpected profile: ${agent.profileId}`)
      return [role, agent]
    }),
  )
}, 60_000)

afterAll(async () => {
  await server.stop()
  await mock.stop()
})

function delegationCall(to: string, text: string) {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: `call-delegate-${to}`,
              type: 'function',
              function: {
                name: 'send_message',
                arguments: JSON.stringify({ to, text }),
              },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
  }
}

function finalReply(content: string) {
  return {
    choices: [
      {
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
  }
}

test('a real coordinator turn delegates through policy into the researcher inbox', async () => {
  const brief = 'Please research the confirmed topic and return source URLs.'
  mock.push([
    delegationCall(agentId('researcher'), brief),
    finalReply('Delegated to the researcher.'),
  ])

  const chat = await server.cli([
    'agent',
    'chat',
    agentId('coordinator'),
    '--message',
    'Start the current cycle.',
  ])
  expect(chat.exitCode, chat.stderr).toBe(0)
  expect(chat.stdout).toContain('Delegated to the researcher.')

  const inbox = await api<ListInboxResponse>(`/api/agents/${agentId('researcher')}/messages`)
  const delegated = inbox.messages.find(
    (message: Message) => message.fromAgentId === agentId('coordinator'),
  )
  expect(delegated).toBeDefined()
  expect(delegated?.toAgentId).toBe(agentId('researcher'))
  expect(JSON.parse(delegated?.payload ?? '{}')).toMatchObject({ text: brief })
  expect(delegated?.readAt).toBeNull()

  // Scheduler/inbox auto-delivery is off: delivery must not itself start a
  // researcher turn. Exactly two LLM responses were consumed, both the
  // coordinator's; no research/image capability ran anywhere.
  expect(mock.callCount()).toBe(2)
})

test('the operator HTTP message route cannot launder a specialist-to-specialist send', async () => {
  const denied = await api<{ decision?: string; reasonCode?: string }>(
    `/api/agents/${agentId('writer')}/messages`,
    {
      from: agentId('researcher'),
      payload: { text: 'Skip the coordinator; work with me directly.' },
    },
    403,
  )
  expect(denied.decision).toBe('deny')

  const inbox = await api<ListInboxResponse>(`/api/agents/${agentId('writer')}/messages`)
  expect(inbox.messages).toHaveLength(0)
  expect(mock.callCount()).toBe(2)
})

test('the canned model never touched image generation, search or publishing tools', async () => {
  // Structural: the fixture exposes no image/search/publish endpoint to call, and
  // the recorded LLM calls are the only provider requests in the whole suite.
  expect(mock.callCount()).toBe(2)
  expect(agents.size).toBe(4)
  expect(readFileSync(join(recipe, 'team-template.json'), 'utf8')).not.toContain('image_generate')
})
