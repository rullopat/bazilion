import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Agent, ListTriggerDispatchesResponse } from '@bazilion/api-types'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  type CannedResponse,
  type MockLlm,
  sseFromCanned,
  startLmStudioMock,
} from './fixtures/mock-lmstudio.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

// BAZ-065 third slice: trigger lifecycle through supported management (CT-11),
// bounded failure retries with truthful history (CT-13's retry half), and the
// daemon-timezone cron contract (CT-09 partial — the daemon runs TZ=UTC here;
// DST gap/repeat needs controlled clocks and stays open). The operator's
// machine timezone is never touched. Canned model = plumbing evidence only.
const recipe = join(import.meta.dirname, '../../../examples/content-team')
const roles = ['coordinator', 'researcher', 'writer', 'designer'] as const

let mock: MockLlm
let server: TestServer
let agents = new Map<(typeof roles)[number], Agent>()
// Dedicated daemon timezone: UTC for this fixture. Cron fields are computed in UTC to match.
const daemonEnv: NodeJS.ProcessEnv = {
  LMSTUDIO_URL: '',
  BAZILION_TEAM_POLICY_ENFORCEMENT: 'on',
  BAZILION_SCHEDULER_TICK_MS: '200',
  BAZILION_IMAGE_GENERATION: 'off',
  TZ: 'UTC',
}

function agentId(role: (typeof roles)[number]): string {
  const id = agents.get(role)?.id
  if (!id) throw new Error(`missing role ${role}`)
  return id
}

function reply(content: string): CannedResponse {
  return {
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
  }
}

async function until(
  fn: () => boolean | Promise<boolean>,
  ms: number,
  what: string,
): Promise<void> {
  const start = Date.now()
  for (;;) {
    if (await fn()) return
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 200))
  }
}

async function addTrigger(
  spec: { every?: number; cron?: string },
  message: string,
): Promise<string> {
  const args = ['trigger', 'add', agentId('coordinator')]
  if (spec.every) args.push('--every', String(spec.every))
  else args.push('--cron', spec.cron ?? '')
  args.push('--message', message)
  const added = await server.cli(args)
  expect(added.exitCode, added.stderr).toBe(0)
  const triggerId = added.stdout.split('\t')[0] ?? ''
  expect(triggerId).toMatch(/^[0-9a-f-]{36}$/)
  return triggerId
}

async function dispatches(triggerId: string): Promise<ListTriggerDispatchesResponse> {
  const response = await fetch(`${server.url}/api/triggers/${triggerId}/dispatches?limit=10`, {
    headers: { authorization: `Bearer ${server.token}` },
  })
  expect(response.status).toBe(200)
  return (await response.json()) as ListTriggerDispatchesResponse
}

beforeAll(async () => {
  mock = await startLmStudioMock()
  daemonEnv.LMSTUDIO_URL = mock.url
  server = await startTestServer(daemonEnv)
  await server.cli(['skill', 'import', '--from', join(recipe, 'skills')])
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
  await server.cli(['team-template', 'import', join(recipe, 'team-template.json'), '--apply'])
  const response = await fetch(`${server.url}/api/team-templates/content-preparation/spawn`, {
    method: 'POST',
    headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      templateExpectedRevision: 1,
      teamId: 'content-cron',
      mode: 'initialize',
    }),
  })
  expect(response.status).toBe(201)
  const spawned = (await response.json()) as { agents: Agent[] }
  agents = new Map(
    spawned.agents.map((a) => {
      const role = roles.find((r) => a.profileId === `content-${r}`)
      if (!role) throw new Error(`unexpected profile ${a.profileId}`)
      return [role, a] as const
    }),
  )
}, 60_000)

afterAll(async () => {
  await server.stop()
  await mock.stop()
})

test('CT-11: disable pauses cycles, re-enable resumes, delete stops them permanently', async () => {
  let rounds = 0
  mock.setFallback(
    async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
      for await (const _bytes of req) void _bytes
      rounds++
      sseFromCanned(res, reply('CYCLE_DONE'))
    },
  )

  // A 2s interval cycles continuously; every round is one cycle.
  const triggerId = await addTrigger({ every: 2 }, 'Preparation cycle.')
  await until(() => rounds >= 2, 30_000, 'recurring cycles to start')

  const disabled = await server.cli(['trigger', 'disable', triggerId])
  expect(disabled.exitCode).toBe(0)
  const atDisable = rounds
  await new Promise((r) => setTimeout(r, 5_000))
  expect(rounds).toBe(atDisable)

  const enabled = await server.cli(['trigger', 'enable', triggerId])
  expect(enabled.exitCode).toBe(0)
  await until(() => rounds >= atDisable + 2, 30_000, 'cycles to resume')

  const removed = await server.cli(['trigger', 'rm', triggerId])
  expect(removed.exitCode).toBe(0)
  // Let the last in-flight dispatch settle before asserting permanence.
  let settleMarker = rounds
  for (;;) {
    await new Promise((r) => setTimeout(r, 1_500))
    if (rounds === settleMarker) break
    settleMarker = rounds
  }
  const atRemove = rounds
  await new Promise((r) => setTimeout(r, 5_000))
  expect(rounds).toBe(atRemove)
}, 240_000)

test('CT-13 retry half: a failing turn retries with a bounded attempt count, then fails terminally', async () => {
  let providerHits = 0
  mock.setFallback(
    async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
      for await (const _bytes of req) void _bytes
      providerHits++
      res.writeHead(500).end('fixture: provider failure')
    },
  )

  const triggerId = await addTrigger({ every: 2 }, 'Preparation cycle.')
  // 3 attempts per dispatch; wait for several dispatches to go terminal.
  await until(
    async () => {
      const history = await dispatches(triggerId)
      return (
        history.dispatches.filter((d) => d.status === 'failed' && d.attemptCount >= 3).length >= 2
      )
    },
    180_000,
    'bounded failures to go terminal',
  )
  const atCheck = providerHits
  const history = await dispatches(triggerId)
  // A recurring trigger always materializes fresh dispatches; the invariant is
  // that every TERMINAL dispatch exhausted exactly 3 attempts, truthfully.
  const terminal = history.dispatches.filter((d) => d.status === 'failed')
  expect(terminal.length).toBeGreaterThanOrEqual(2)
  for (const d of terminal) {
    expect(d.attemptCount).toBe(3)
    expect(d.lastError).toBeTruthy()
  }
  // Terminal: no further provider attempts once every dispatch failed.
  await new Promise((r) => setTimeout(r, 4_000))
  expect(providerHits).toBeLessThanOrEqual(atCheck + 3)
  await server.cli(['trigger', 'rm', triggerId])
}, 300_000)

test('CT-09 partial: a TZ=UTC daemon fires cron at the UTC minute, not the test-local minute', async () => {
  let cronRounds = 0
  mock.setFallback(
    async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
      for await (const _bytes of req) void _bytes
      cronRounds++
      sseFromCanned(res, reply('UTC_CYCLE_DONE'))
    },
  )

  // Next UTC minute boundary; the cron expression is built from UTC fields.
  const dueMs = Math.ceil((Date.now() + 6_000) / 60_000) * 60_000
  const due = new Date(dueMs)
  const expr = `${due.getUTCMinutes()} ${due.getUTCHours()} * * *`
  appendFileSync('/tmp/baz064-cron-plan.log', `${new Date().toISOString()} utc cron=${expr}\n`)
  const triggerId = await addTrigger({ cron: expr }, 'Preparation cron: start the cycle.')

  await until(() => cronRounds >= 1, 150_000, 'the UTC cron occurrence')
  await new Promise((r) => setTimeout(r, 3_000))
  // LLM rounds may retry under machine load; the dispatch record is the oracle.
  expect(cronRounds).toBeGreaterThanOrEqual(1)
  expect(cronRounds).toBeLessThanOrEqual(3)
  await until(
    async () => (await dispatches(triggerId)).dispatches.length >= 1,
    30_000,
    'the dispatch record',
  )
  const history = await dispatches(triggerId)
  expect(history.dispatches[0]?.scheduledAt).toBe(dueMs)
  const disabled = await server.cli(['trigger', 'disable', triggerId])
  expect(disabled.exitCode).toBe(0)
}, 240_000)
