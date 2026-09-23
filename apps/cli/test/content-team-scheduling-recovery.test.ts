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
import { restartTestServer, startTestServer, type TestServer } from './server-fixture.ts'

// BAZ-065 second slice: CT-10 busy/deferred dispatch and CT-12 crash/restart
// semantics, driven by real cron minutes on the daemon's own scheduler. The
// canned model proves scheduler plumbing, not model judgment. The documented
// no-catch-up limitation for missed minutes is asserted as observed behavior.
const recipe = join(import.meta.dirname, '../../../examples/content-team')
const docker = process.env.BAZILION_TEST_DOCKER === '1'
const roles = ['coordinator', 'researcher', 'writer', 'designer'] as const

let mock: MockLlm
let server: TestServer
let agents = new Map<(typeof roles)[number], Agent>()
const daemonEnv = {
  LMSTUDIO_URL: '',
  BAZILION_TEAM_POLICY_ENFORCEMENT: 'on',
  BAZILION_SCHEDULER_TICK_MS: '200',
  BAZILION_IMAGE_GENERATION: 'off',
}

function agentId(role: (typeof roles)[number]): string {
  const id = agents.get(role)?.id
  if (!id) throw new Error(`missing role ${role}`)
  return id
}

function toolCall(name: string, args: unknown): CannedResponse {
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

async function addCronTrigger(atMinute: Date, message: string): Promise<string> {
  const expr = `${atMinute.getMinutes()} ${atMinute.getHours()} * * *`
  appendFileSync('/tmp/baz064-cron-plan.log', `${new Date().toISOString()} cron=${expr}\n`)
  const added = await server.cli([
    'trigger',
    'add',
    agentId('coordinator'),
    '--cron',
    expr,
    '--message',
    message,
  ])
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

test.skipIf(!docker)(
  'CT-10: a due minute while the Agent is busy defers the dispatch; it runs exactly once after release',
  async () => {
    const due = new Date(Math.ceil((Date.now() + 6_000) / 60_000) * 60_000)
    const triggerId = await addCronTrigger(due, 'Preparation cron: start the cycle.')

    // Busy the coordinator with a real blocking tool call (no LLM round while it
    // waits). 75s covers any due minute up to 60s out, so the minute arrives
    // while the Agent has an active turn.
    let cronRounds = 0
    let sawBusyTool = false
    let busyDone = false
    mock.setFallback(
      async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
        // Always drain the request body before responding.
        for await (const _bytes of req) void _bytes
        if (!sawBusyTool) {
          sawBusyTool = true
          sseFromCanned(
            res,
            toolCall('wait_for_reply', { message_id: 'no-such-message', timeout_ms: 75_000 }),
          )
          return
        }
        if (!busyDone) {
          busyDone = true
          sseFromCanned(res, reply('BUSY_TURN_FINISHED'))
          return
        }
        cronRounds++
        sseFromCanned(res, reply('CRON_CYCLE_DONE'))
      },
    )

    const busy = server.cli([
      'agent',
      'chat',
      agentId('coordinator'),
      '--message',
      'Long-running work; keep going.',
    ])

    // Wait for the due minute to pass while the turn is busy.
    await until(() => Date.now() >= due.getTime() + 2_500, 75_000, 'due minute to pass')

    // The busy turn ends; the cron dispatch then runs exactly once — never
    // concurrently with the busy turn and never twice for one occurrence.
    await busy.then((result) => {
      if (result.exitCode !== 0)
        appendFileSync(
          '/tmp/baz064-busy-fail.log',
          `busy chat failed: ${result.stderr || result.stdout}\n`,
        )
      expect(result.exitCode).toBe(0)
    })
    expect(busyDone).toBe(true)
    await until(() => cronRounds >= 1, 90_000, 'the deferred cron turn to run')
    // Under machine load the LLM round itself may retry; the dispatch-level
    // history below is the exactly-once oracle, not the raw request count.
    await new Promise((r) => setTimeout(r, 3_000))
    expect(cronRounds).toBeGreaterThanOrEqual(1)
    expect(cronRounds).toBeLessThanOrEqual(3)

    const history = await dispatches(triggerId)
    const cronDispatches = history.dispatches.filter((d) => d.scheduledAt === due.getTime())
    // One occurrence identity; claim/defers under load may raise the attempt
    // count, but the dispatch must be terminal-successful exactly once.
    expect(cronDispatches.length).toBe(1)
    expect(cronDispatches[0]?.status).toBe('succeeded')
    expect(cronDispatches[0]?.attemptCount).toBeGreaterThanOrEqual(1)
    const disabled = await server.cli(['trigger', 'disable', triggerId])
    expect(disabled.exitCode).toBe(0)
  },
  240_000,
)

test('CT-12a: a trigger created before a due minute survives a daemon restart and fires once', async () => {
  // Due well past the restart (stop+boot take seconds, not minutes).
  const due = new Date(Math.ceil((Date.now() + 80_000) / 60_000) * 60_000)
  const triggerId = await addCronTrigger(due, 'Preparation cron: start the cycle.')
  let cronRounds = 0
  mock.setFallback(
    async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
      for await (const _bytes of req) void _bytes
      cronRounds++
      sseFromCanned(res, reply('POST_RESTART_CYCLE_DONE'))
    },
  )

  await server.stop({ keepHome: true })
  // Restart comfortably before the due minute.
  expect(Date.now()).toBeLessThan(due.getTime() - 5_000)
  server = await restartTestServer(server, daemonEnv)

  // Diagnostic: watch dispatch attempts while waiting.
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 15_000))
    try {
      const history = await dispatches(triggerId)
      appendFileSync(
        '/tmp/baz064-recovery-trace.log',
        `[12a t+${i * 15}s] rounds=${cronRounds} dispatches=${JSON.stringify(history.dispatches)}\n`,
      )
    } catch (e) {
      appendFileSync('/tmp/baz064-recovery-trace.log', `[12a] probe failed: ${e}\n`)
    }
    if (cronRounds >= 1) break
  }
  await until(() => cronRounds >= 1, 60_000, 'the post-restart cron occurrence')
  await new Promise((r) => setTimeout(r, 3_000))
  expect(cronRounds).toBe(1)
  const history = await dispatches(triggerId)
  expect(history.dispatches.length).toBeGreaterThanOrEqual(1)
  const disabled = await server.cli(['trigger', 'disable', triggerId])
  expect(disabled.exitCode).toBe(0)
}, 300_000)

test('CT-12b: a cron minute missed while the daemon is down does not fire after restart', async () => {
  const due = new Date(Math.ceil((Date.now() + 15_000) / 60_000) * 60_000)
  const triggerId = await addCronTrigger(due, 'Preparation cron: start the cycle.')
  let cronRounds = 0
  mock.setFallback(
    async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
      for await (const _bytes of req) void _bytes
      cronRounds++
      sseFromCanned(res, reply('UNEXPECTED_CYCLE'))
    },
  )

  // Down across the due minute; restart only after the whole minute has
  // passed (a restart inside the minute correctly materializes it).
  await server.stop({ keepHome: true })
  await until(
    () => Date.now() >= due.getTime() + 65_000,
    150_000,
    'the missed minute to fully pass',
  )
  server = await restartTestServer(server, daemonEnv)

  // Several fast ticks: the missed minute is not replayed (documented
  // limitation — cron materializes only when the current minute matches).
  await new Promise((r) => setTimeout(r, 5_000))
  expect(cronRounds).toBe(0)
  const history = await dispatches(triggerId)
  expect(history.dispatches).toHaveLength(0)
  const removed = await server.cli(['trigger', 'rm', triggerId])
  expect(removed.exitCode).toBe(0)
}, 300_000)
