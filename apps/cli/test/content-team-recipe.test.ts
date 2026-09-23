import { once } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import type {
  Agent,
  CommunicationAuthorizationResult,
  CommunicationEndpoint,
  ResolvedSkillsResponse,
  ResolvedTeamPolicy,
  Team,
} from '@bazilion/api-types'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { parseTeamDocument } from '../src/team-interchange.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

// Management/policy integration only: no scripted model pretending to demonstrate research,
// approval compliance, protected worker execution or the composed CT acceptance journey.
const recipe = join(import.meta.dirname, '../../../examples/content-team')
const templatePath = join(recipe, 'team-template.json')
const roles = ['coordinator', 'researcher', 'writer', 'designer'] as const
const document = parseTeamDocument(JSON.parse(readFileSync(templatePath, 'utf8')))
let server: TestServer
let providerRequests = 0
const provider = createServer((request, response) => {
  providerRequests++
  request.resume()
  response.writeHead(503).end('No model execution is permitted in this preflight')
})
interface Spawned {
  agents: Agent[]
  team: ResolvedTeamPolicy
}
let first: Spawned
let second: Spawned

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

function member(spawned: Spawned, role: (typeof roles)[number]): Agent {
  const agent = spawned.agents.find((value) => value.profileId === `content-${role}`)
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
    BAZILION_TEAM_POLICY_ENFORCEMENT: 'on',
    BAZILION_SCHEDULER: 'off',
    BAZILION_IMAGE_GENERATION: 'off',
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
  const dryRun = await server.cli(['team-template', 'import', templatePath, '--dry-run'])
  expect(dryRun.exitCode, dryRun.stderr).toBe(0)
  expect(dryRun.stdout).toContain('valid: no changes applied')
  await api('/api/team-templates/content-preparation', undefined, 404)
  const applied = await server.cli(['team-template', 'import', templatePath, '--apply'])
  expect(applied.exitCode, applied.stderr).toBe(0)
  for (const teamId of ['content-first', 'content-second']) {
    const body = { templateExpectedRevision: 1, teamId, mode: 'initialize' }
    await api('/api/team-templates/content-preparation/spawn/preview', body)
    await api(`/api/teams/${teamId}`, undefined, 404)
    const spawned = await api<Spawned>('/api/team-templates/content-preparation/spawn', body, 201)
    if (teamId === 'content-first') first = spawned
    else second = spawned
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

test('portable recipe spawns exact role documents, selected skill and canonical lineage', async () => {
  expect(document.kind).toBe('bazilion.team-template')
  expect(document.slots.map((slot) => slot.key)).toEqual([...roles])
  expect(document.edges).toHaveLength(8)
  expect(document.edges.every((edge) => edge.posture === 'allow')).toBe(true)
  expect(first.agents).toHaveLength(4)
  expect(first.team.members.map((agent) => agent.id).sort()).toEqual(
    first.agents.map((agent) => agent.id).sort(),
  )
  expect(first.team.bindings).toHaveLength(4)
  expect(first.team.instantiations).toHaveLength(1)
  expect(first.team.edges).toHaveLength(8)
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
    const binding = first.team.bindings.find((value) => value.agentId === agent.id)
    expect(binding?.instantiationId).toBe(first.team.instantiations[0]?.id)
    expect(binding?.sourceSlotId).toMatch(/^[0-9a-f-]{36}$/)
  }
})

test('live policy allows only coordinator spokes and denies specialists, outside and cross-Team paths', async () => {
  const endpoints: Array<{ key: string; endpoint: CommunicationEndpoint }> = [
    { key: 'user', endpoint: { kind: 'user', teamId: 'content-first' } },
    { key: 'outside', endpoint: { kind: 'outside_team', teamId: 'content-first' } },
    ...roles.map((role) => ({
      key: role,
      endpoint: { kind: 'agent' as const, id: member(first, role).id },
    })),
    { key: 'other', endpoint: { kind: 'agent', id: member(second, 'coordinator').id } },
  ]
  let checked = 0
  for (const source of endpoints) {
    for (const target of endpoints) {
      if (source.key === target.key) continue
      if (source.endpoint.kind !== 'agent' && target.endpoint.kind !== 'agent') continue
      // Cross-Team checks here are Agent-to-Agent. The owner is global, not a second Team's user.
      if (
        (source.key === 'other' || target.key === 'other') &&
        (source.endpoint.kind !== 'agent' || target.endpoint.kind !== 'agent')
      )
        continue
      const result = await api<CommunicationAuthorizationResult>('/api/communication/evaluate', {
        source: source.endpoint,
        target: target.endpoint,
        origin: 'content_recipe_preflight',
        attemptKind: 'diagnostic',
        attemptId: `${source.key}:${target.key}`,
      })
      const peer = source.key === 'coordinator' ? target.key : source.key
      const allowed =
        (source.key === 'coordinator' || target.key === 'coordinator') &&
        ['user', 'researcher', 'writer', 'designer'].includes(peer)
      expect(result.decision, `${source.key} -> ${target.key}`).toBe(allowed ? 'allow' : 'deny')
      checked++
    }
  }
  expect(checked).toBe(36)
})

test('the same template creates disjoint Teams without embedding a topic or an approval', async () => {
  expect(second.agents).toHaveLength(4)
  const originalIds = new Set(first.agents.map((agent) => agent.id))
  expect(second.agents.every((agent) => !originalIds.has(agent.id))).toBe(true)
  expect(second.team.instantiations[0]?.id).not.toBe(first.team.instantiations[0]?.id)
  for (const teamId of ['content-first', 'content-second']) {
    const team = await api<Team>(`/api/teams/${teamId}`)
    expect(team.userMd).toBe(document.template.userMd)
    expect(team.userMd).toContain('no brief or usage grant is prefilled')
  }
  expect(providerRequests).toBe(0)
})

test('actual HTTP ingress to each specialist is denied before a provider call', async () => {
  for (const role of ['researcher', 'writer', 'designer'] as const) {
    const agent = member(first, role)
    const denied = await api<{ code: string; decision: string }>(
      `/api/agents/${agent.id}/chat`,
      {
        message: 'Bypass the coordinator and start work for me directly.',
        expectedSelection: { revision: 0, conversationId: null },
      },
      403,
    )
    expect(denied.code).toBe('communication_denied')
    expect(denied.decision).toBe('deny')
  }
  expect(providerRequests).toBe(0)
})
