import { once } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import type {
  Agent,
  ResolvedSkillsResponse,
  Team,
  TeamPolicy,
  TeamTemplateInput,
} from '@bazilion/api-types'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { startTestServer, type TestServer } from './server-fixture.ts'

// Installs examples/content-team through the CLI and checks the Teams it spawns. No model runs:
// the provider answers 503 and must never be called.
const recipe = join(import.meta.dirname, '../../../examples/content-team')
const templatePath = join(recipe, 'team-template.json')
const roles = ['coordinator', 'researcher', 'writer', 'designer'] as const
const document = JSON.parse(readFileSync(templatePath, 'utf8')) as TeamTemplateInput
let server: TestServer
let providerRequests = 0
const provider = createServer((request, response) => {
  providerRequests++
  request.resume()
  response.writeHead(503).end('No model execution is permitted in this preflight')
})
let first: TeamPolicy
let second: TeamPolicy

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

function member(team: TeamPolicy, role: (typeof roles)[number]): Agent {
  const agent = team.members.find((value) => value.profileId === `content-${role}`)
  if (!agent) throw new Error(`Missing recipe role: ${role}`)
  return agent
}

beforeAll(async () => {
  provider.listen(0, '127.0.0.1')
  await once(provider, 'listening')
  const address = provider.address()
  if (!address || typeof address === 'string') throw new Error('Missing provider address')
  const url = `http://127.0.0.1:${address.port}`
  server = await startTestServer({
    BAZILION_SCHEDULER: 'off',
    TELEGRAM_BOT_TOKEN: '',
    LMSTUDIO_URL: `${url}/v1`,
    OLLAMA_URL: url,
  })
  const imported = await server.cli(['skill', 'import', '--from', join(recipe, 'skills')])
  expect(imported.exitCode, imported.stderr).toBe(0)
  expect(imported.stdout).toContain('content-preparation')
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
      join(recipe, 'profiles', `${role}.md`),
      '--agents-file',
      join(recipe, 'operating-rules.md'),
      '--tools-file',
      join(recipe, 'tools.md'),
    ])
    expect(created.exitCode, created.stderr).toBe(0)
  }
  const imported2 = await server.cli(['team-template', 'import', templatePath])
  expect(imported2.exitCode, imported2.stderr).toBe(0)
  expect(imported2.stdout).toContain('created Team template content-preparation (4 slots, 6 edges)')
  for (const teamId of ['content-first', 'content-second']) {
    await api(`/api/teams/${teamId}`, undefined, 404)
    const spawned = await server.cli(['team-template', 'spawn', 'content-preparation', teamId])
    expect(spawned.exitCode, spawned.stderr).toBe(0)
    expect(spawned.stdout).toContain(`spawned 4 agent(s) into Team ${teamId}`)
    const team = await api<TeamPolicy>(`/api/teams/${teamId}/policy`)
    if (teamId === 'content-first') first = team
    else second = team
  }
}, 60_000)

afterAll(async () => {
  try {
    if (server) await server.stop()
  } finally {
    if (provider.listening) {
      await new Promise<void>((resolve, reject) =>
        provider.close((error) => (error ? reject(error) : resolve())),
      )
    }
  }
  expect(providerRequests).toBe(0)
})

test('the recipe spawns a restricted Team with exact role documents and selected skill', async () => {
  expect(document.slots?.map((slot) => slot.profileId)).toEqual(
    roles.map((role) => `content-${role}`),
  )
  expect(document.edges).toHaveLength(6)
  expect(first.members).toHaveLength(4)
  expect(first.mode).toBe('restricted')
  expect(first.edges).toHaveLength(6)
  for (const role of roles) {
    const agent = member(first, role)
    expect(agent.teamId).toBe('content-first')
    expect(agent.modelOverride).toBeNull()
    expect(readFileSync(join(agent.dir, 'SOUL.md'), 'utf8')).toBe(
      readFileSync(join(recipe, 'profiles', `${role}.md`), 'utf8'),
    )
    expect(readFileSync(join(agent.dir, 'AGENTS.md'), 'utf8')).toBe(
      readFileSync(join(recipe, 'operating-rules.md'), 'utf8'),
    )
    expect(readFileSync(join(agent.dir, 'TOOLS.md'), 'utf8')).toBe(
      readFileSync(join(recipe, 'tools.md'), 'utf8'),
    )
    expect(existsSync(join(agent.dir, 'BOOTSTRAP.md'))).toBe(false)
    const skills = await api<ResolvedSkillsResponse>(`/api/agents/${agent.id}/skills`)
    expect(skills.missing).toEqual([])
    expect(skills.resolved.map((skill) => skill.name)).toEqual(['content-preparation'])
    expect(skills.resolved[0]?.scanFindings).toEqual([])
  }
})

test('messages flow only along coordinator spokes and never to another Team', async () => {
  const agents = [
    ...roles.map((role) => ({ key: role as string, id: member(first, role).id })),
    { key: 'other', id: member(second, 'coordinator').id },
  ]
  let checked = 0
  for (const source of agents) {
    for (const target of agents) {
      if (source.key === target.key) continue
      const response = await fetch(`${server.url}/api/agents/${target.id}/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: source.id, payload: { text: 'preflight' } }),
      })
      const spoke =
        (source.key === 'coordinator' || target.key === 'coordinator') &&
        source.key !== 'other' &&
        target.key !== 'other'
      expect(response.status, `${source.key} -> ${target.key}`).toBe(spoke ? 201 : 403)
      checked++
    }
  }
  expect(checked).toBe(20)
  expect(providerRequests).toBe(0)
})

test('the same template creates disjoint Teams without embedding a topic', async () => {
  expect(second.members).toHaveLength(4)
  const originalIds = new Set(first.members.map((agent) => agent.id))
  expect(second.members.every((agent) => !originalIds.has(agent.id))).toBe(true)
  for (const teamId of ['content-first', 'content-second']) {
    const team = await api<Team>(`/api/teams/${teamId}`)
    expect(team.userMd).toBe(document.userMd)
    expect(team.userMd).toContain('no brief or usage grant is prefilled')
  }
  expect(providerRequests).toBe(0)
})
