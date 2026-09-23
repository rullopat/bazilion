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

// BAZ-065 first slice (CT-08 core): a real cron trigger drives the coordinator
// through two actual due minutes with the daemon's own scheduler — no manual
// prompt or fake tick stands in for it. The canned model again proves plumbing
// (trigger → dispatch → turn → delegation), not model judgment. The two listed
// minutes are the explicitly recorded acceleration; the recipe's requested
// cadence remains an operator decision. Live/human lanes stay in BAZ-066.
const recipe = join(import.meta.dirname, '../../../examples/content-team')
const roles = ['coordinator', 'researcher', 'writer', 'designer'] as const
const docker = process.env.BAZILION_TEST_DOCKER === '1'
const WAKE_MARKER = '[[bazilion:inbox-wake]]'

let mock: MockLlm
let server: TestServer
let agents = new Map<(typeof roles)[number], Agent>()
let triggerId = ''
const rounds: { wake: boolean; at: number }[] = []

function agentId(role: (typeof roles)[number]): string {
  const id = agents.get(role)?.id
  if (!id) throw new Error(`missing role ${role}`)
  return id
}

function router(coordinator: CannedResponse[], researcher: CannedResponse[]) {
  return async (
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ) => {
    let raw = ''
    for await (const bytes of req) raw += String(bytes)
    const wake = raw.includes(WAKE_MARKER)
    rounds.push({ wake, at: Date.now() })
    const queue = wake ? researcher : coordinator
    const item = queue.shift()
    if (!item) {
      res.writeHead(500).end('no canned response')
      return
    }
    sseFromCanned(res, item)
  }
}

function delegateCall(to: string, text: string): CannedResponse {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: `call-del-${Math.random().toString(36).slice(2, 6)}`,
              type: 'function',
              function: { name: 'send_message', arguments: JSON.stringify({ to, text }) },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
  }
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

async function until(fn: () => boolean, ms: number, what: string): Promise<void> {
  const start = Date.now()
  for (;;) {
    if (fn()) return
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 250))
  }
}

beforeAll(async () => {
  mock = await startLmStudioMock()
  mock.setFallback(router([], []))
  server = await startTestServer({
    LMSTUDIO_URL: mock.url,
    BAZILION_TEAM_POLICY_ENFORCEMENT: 'on',
    BAZILION_IMAGE_GENERATION: 'off',
    BAZILION_SCHEDULER_TICK_MS: '200',
    ...(docker ? { BAZILION_BASH_SANDBOX: 'docker' } : {}),
  })
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
  'two actual cron minutes drive coordinator cycles with distinct dispatches',
  async () => {
    // Two cron minutes, one minute apart, in the daemon's own local time — the
    // explicitly recorded acceleration for this test; the requested cadence for
    // real use is a separate operator decision (no per-trigger timezone exists).
    const nextMinute = Math.ceil((Date.now() + 5_000) / 60_000) * 60_000
    const first = new Date(nextMinute)
    const second = new Date(nextMinute + 60_000)
    const expr = `${first.getMinutes()},${second.getMinutes()} * * * *`
    appendFileSync('/tmp/baz064-cron-plan.log', `${new Date().toISOString()} cron=${expr}\n`)

    // Two cron cycles: each delegates once, then finishes.
    const coordinator: CannedResponse[] = []
    const researcher: CannedResponse[] = []
    for (const [n, target] of [
      [1, 'researcher'],
      [2, 'researcher'],
    ] as const) {
      coordinator.push(delegateCall(agentId(target), `Cron cycle ${n}: prepare the next cycle.`))
      coordinator.push(reply(`CYCLE_${n}_DELEGATED`))
      if (docker) {
        // A wake turn without tool calls ends after a single model round.
        researcher.push(reply(`RESEARCH_CYCLE_${n}_DONE`))
      }
    }
    mock.setFallback(router(coordinator, researcher))

    const added = await server.cli([
      'trigger',
      'add',
      agentId('coordinator'),
      '--cron',
      expr,
      '--message',
      'Preparation cron: start the next cycle.',
    ])
    expect(added.exitCode, added.stderr).toBe(0)
    triggerId = added.stdout.split('\t')[0] ?? ''
    expect(triggerId).toMatch(/^[0-9a-f-]{36}$/)

    // Occurrence 1: coordinator round pair.
    await until(() => rounds.filter((r) => !r.wake).length >= 2, 150_000, 'first cron occurrence')
    // Occurrence 2 happens one minute later.
    await until(() => rounds.filter((r) => !r.wake).length >= 4, 150_000, 'second cron occurrence')
    await until(
      () => (docker ? rounds.filter((r) => r.wake).length >= 2 : true),
      120_000,
      'researcher wakes',
    )
    const cycles = rounds.filter((r) => !r.wake).length
    expect(cycles).toBe(4)

    // Let the occurrence-2 turn fully settle (its final round may still be in
    // flight), then disable; afterward several fast ticks produce no new rounds.
    let settleMarker = rounds.length
    for (;;) {
      await new Promise((r) => setTimeout(r, 1_500))
      if (rounds.length === settleMarker) break
      settleMarker = rounds.length
    }
    const disabled = await server.cli(['trigger', 'disable', triggerId])
    expect(disabled.exitCode).toBe(0)
    const marker = rounds.length
    await new Promise((r) => setTimeout(r, 3_000))
    expect(rounds.length).toBe(marker)

    // Dispatch history: two actual occurrences with distinct scheduled minutes.
    const response = await fetch(`${server.url}/api/triggers/${triggerId}/dispatches?limit=10`, {
      headers: { authorization: `Bearer ${server.token}` },
    })
    expect(response.status).toBe(200)
    const history = (await response.json()) as ListTriggerDispatchesResponse
    expect(history.dispatches.length).toBeGreaterThanOrEqual(2)
    const scheduled = new Set(history.dispatches.map((d) => String(d.scheduledAt)))
    expect(scheduled.size).toBeGreaterThanOrEqual(2)
  },
  300_000,
)

test.runIf(docker)(
  'CT-16 partial: the scheduled turn itself runs in the protected container posture',
  async () => {
    // One cron occurrence whose canned turn dumps the coding-command container
    // environment: scheduled execution must be container-postured and
    // credential-minimal where it is claimed — no daemon secrets, no provider
    // or search credentials, no host fallback.
    const due = new Date(Math.ceil((Date.now() + 80_000) / 60_000) * 60_000)
    const expr = `${due.getMinutes()} ${due.getHours()} * * *`
    const coordinator: CannedResponse[] = []
    const researcher: CannedResponse[] = []
    const containerRounds: number[] = []
    const trace = (line: string) => appendFileSync('/tmp/baz064-ct16-trace.log', `${line}\n`)
    let cronRound = 0
    const ownRouter = async (
      req: import('node:http').IncomingMessage,
      res: import('node:http').ServerResponse,
    ) => {
      let raw = ''
      for await (const bytes of req) raw += String(bytes)
      const wake = raw.includes(WAKE_MARKER)
      if (wake) {
        const item = researcher.shift()
        if (item) sseFromCanned(res, item)
        else res.writeHead(500).end('no canned response')
        return
      }
      cronRound++
      containerRounds.push(Date.now())
      const item = coordinator.shift()
      if (!item) {
        res.writeHead(500).end('no canned response')
        return
      }
      sseFromCanned(res, item)
      trace(`cron round ${cronRound} at ${new Date().toISOString()}`)
    }
    mock.setFallback(ownRouter)

    coordinator.push(
      toolCall('coding_command', {
        command: 'env > scheduled-env-dump.txt && test "$PWD" = /workspace',
        cwd: '.',
        purpose: 'test',
        timeoutSeconds: 10,
      }),
    )
    coordinator.push(reply('SCHEDULED_PROBE_DONE'))

    const added = await server.cli([
      'trigger',
      'add',
      agentId('coordinator'),
      '--cron',
      expr,
      '--message',
      'Preparation cron: start the cycle.',
    ])
    expect(added.exitCode, added.stderr).toBe(0)
    const triggerId = added.stdout.split('\t')[0] ?? ''

    await until(() => cronRound >= 2, 180_000, 'the scheduled occurrence to run its two rounds')
    await new Promise((r) => setTimeout(r, 2_000))

    const { readdirSync, readFileSync: readFile, statSync } = await import('node:fs')
    const findFile = (dir: string, name: string): string | null => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry)
        if (statSync(p).isDirectory()) {
          const hit = findFile(p, name)
          if (hit) return hit
        } else if (entry === name) return p
      }
      return null
    }
    const dump = findFile(join(server.home, 'teams'), 'scheduled-env-dump.txt')
    expect(dump, 'the scheduled turn did not write the container env dump').not.toBeNull()
    const env = readFile(dump as string, 'utf8')
    expect(env).toContain('PATH=')
    for (const forbidden of [
      server.token,
      'OPENAI_API_KEY=',
      'OPENROUTER_API_KEY=',
      'BRAVE_API_KEY=',
      'SEARXNG_URL=',
      'FIRECRAWL_API_KEY=',
    ]) {
      expect(
        env,
        `scheduled container env must not contain ${forbidden.slice(0, 20)}`,
      ).not.toContain(forbidden)
    }
    const response = await fetch(`${server.url}/api/triggers/${triggerId}/dispatches?limit=5`, {
      headers: { authorization: `Bearer ${server.token}` },
    })
    const history = (await response.json()) as ListTriggerDispatchesResponse
    expect(history.dispatches[0]?.status).toBe('succeeded')
    const disabled = await server.cli(['trigger', 'disable', triggerId])
    expect(disabled.exitCode).toBe(0)
  },
  300_000,
)
