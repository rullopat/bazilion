import { join } from 'node:path'
import type {
  Agent,
  CommunicationApproval,
  ListTriggerDispatchesResponse,
  ListTriggersResponse,
} from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test } from 'vitest'
import type { TeamPolicyDocument } from '../src/team-interchange.ts'
import {
  type CannedResponse,
  type MockLlm,
  sseFromCanned,
  startLmStudioMock,
} from './fixtures/mock-lmstudio.ts'
import { schedulingEvidence } from './fixtures/scheduling-evidence.ts'
import { startTestServer, stopSettledTestServer, type TestServer } from './server-fixture.ts'

// BAZ-065 first slice (CT-08 core): a real cron trigger drives the coordinator
// through two actual due minutes with the daemon's own scheduler — no manual
// prompt or fake tick stands in for it. The canned model again proves plumbing
// (trigger → dispatch → turn → delegation), not model judgment. The two listed
// minutes are the explicitly recorded acceleration; the recipe's requested
// cadence remains an operator decision. Live/human lanes are unrun and not scheduled.
const recipe = join(import.meta.dirname, '../../../examples/content-team')
const roles = ['coordinator', 'researcher', 'writer', 'designer'] as const
const docker = process.platform === 'linux' && process.env.BAZILION_TEST_DOCKER === '1'
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

beforeEach(async () => {
  // A failed occurrence must not keep consuming a later scenario's canned responses or leases.
  rounds.length = 0
  agents.clear()
  triggerId = ''
  mock = await startLmStudioMock()
  mock.setFallback(router([], []))
  server = await startTestServer({
    LMSTUDIO_URL: mock.url,
    LMSTUDIO_API_KEY: 'synthetic-lmstudio-fixture-key',
    TZ: 'UTC',
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

function closedFailureReason(error: string | null | undefined): string | null {
  if (!error) return null
  const phase =
    /^Protected Docker runtime is unavailable(?: \((engine|create|start|cleanup)(: timeout)?\))?\./.exec(
      error,
    )
  if (phase) return `protected_docker_${phase[1] ?? 'unspecified'}${phase[2] ? '_timeout' : ''}`
  if (error.includes('workspace_recovery_required')) return 'workspace_recovery_required'
  if (error.includes('workspace_busy')) return 'workspace_busy'
  return 'other failure'
}

async function recordFixtureDispatchFacts(): Promise<void> {
  if (
    process.env.BAZILION_TEST_SCHEDULING_EVIDENCE !== '1' ||
    !server ||
    !agents.has('coordinator')
  )
    return
  try {
    const headers = { authorization: `Bearer ${server.token}` }
    const response = await fetch(`${server.url}/api/agents/${agentId('coordinator')}/triggers`, {
      headers,
      signal: AbortSignal.timeout(1_500),
    })
    if (!response.ok) throw new Error('fixture diagnostic unavailable')
    const listed = (await response.json()) as ListTriggersResponse
    for (const trigger of listed.triggers.slice(0, 4)) {
      const historyResponse = await fetch(
        `${server.url}/api/triggers/${trigger.id}/dispatches?limit=5`,
        { headers, signal: AbortSignal.timeout(1_500) },
      )
      if (!historyResponse.ok) throw new Error('fixture diagnostic unavailable')
      const history = (await historyResponse.json()) as ListTriggerDispatchesResponse
      schedulingEvidence('cron-fixture-dispatch-facts', {
        providerRounds: mock.callCount(),
        dispatches: history.dispatches.map(
          ({ id, scheduledAt, status, attemptCount, lastError }) => ({
            id,
            scheduledAt,
            status,
            attemptCount,
            failure: closedFailureReason(lastError),
          }),
        ),
      })
    }
  } catch {
    // Observability cannot replace or erase a failure, and may not publish raw error material.
    schedulingEvidence('cron-fixture-dispatch-facts-unavailable', {})
  }
}

afterEach(async () => {
  await recordFixtureDispatchFacts()
  try {
    await stopSettledTestServer(server)
  } finally {
    await mock.stop()
  }
  schedulingEvidence('cron-fixture-stopped', { daemonClosed: true, mockClosed: true })
}, 30_000)

test.skipIf(!docker)(
  'two actual cron minutes drive coordinator cycles with distinct dispatches',
  async () => {
    // Two cron minutes, one minute apart, in the daemon's own local time — the
    // explicitly recorded acceleration for this test; the requested cadence for
    // real use is a separate operator decision (no per-trigger timezone exists).
    const nextMinute = Math.ceil((Date.now() + 5_000) / 60_000) * 60_000
    const first = new Date(nextMinute)
    const second = new Date(nextMinute + 60_000)
    const expr = `${first.getUTCMinutes()},${second.getUTCMinutes()} * * * *`

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
    schedulingEvidence('two-cron-occurrences', {
      rounds,
      dispatches: history.dispatches.map(({ id, scheduledAt, status, attemptCount }) => ({
        id,
        scheduledAt,
        status,
        attemptCount,
      })),
      triggerDisabled: disabled.exitCode === 0,
    })
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
    const expr = `${due.getUTCMinutes()} ${due.getUTCHours()} * * *`
    const coordinator: CannedResponse[] = []
    const researcher: CannedResponse[] = []
    const containerRounds: number[] = []
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
      'synthetic-lmstudio-fixture-key',
      'LMSTUDIO_API_KEY=',
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
    schedulingEvidence('scheduled-container-positive', {
      providerRounds: cronRound,
      roundTimes: containerRounds,
      credentialAssertionsPassed: true,
      dispatches: history.dispatches.map(({ id, scheduledAt, status, attemptCount }) => ({
        id,
        scheduledAt,
        status,
        attemptCount,
      })),
      triggerDisabled: disabled.exitCode === 0,
    })
  },
  300_000,
)

test.runIf(docker)(
  'CT-16 negative: a real scheduled worker refuses an unadmitted host read tool',
  async () => {
    const { writeFileSync, readFileSync } = await import('node:fs')
    // Outside the mounted Team/Agent inputs; only non-secret fixture bytes, never auth.json.
    const marker = join(server.home, 'host-only-sentinel.txt')
    const sentinel = 'HOST_ONLY_NON_SECRET_FIXTURE'
    writeFileSync(marker, sentinel)
    const observedTools: string[][] = []
    const toolReplies: string[] = []
    const queue = [toolCall('read', { path: marker }), reply('UNADMITTED_TOOL_REFUSED')]
    mock.setFallback(
      async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
        let raw = ''
        for await (const bytes of req) raw += String(bytes)
        const body = JSON.parse(raw) as {
          tools?: Array<{ function?: { name?: string } }>
          messages?: Array<{ role?: string; content?: unknown }>
        }
        observedTools.push(
          body.tools?.flatMap((t) => (t.function?.name ? [t.function.name] : [])) ?? [],
        )
        for (const message of body.messages ?? []) {
          if (message.role === 'tool') toolReplies.push(JSON.stringify(message.content))
        }
        const item = queue.shift()
        if (item) sseFromCanned(res, item)
        else res.writeHead(500).end('unexpected canned round')
      },
    )

    const due = new Date(Math.ceil((Date.now() + 5_000) / 60_000) * 60_000)
    const added = await server.cli([
      'trigger',
      'add',
      agentId('coordinator'),
      '--cron',
      `${due.getUTCMinutes()} ${due.getUTCHours()} * * *`,
      '--message',
      'Scheduled admission negative: do not execute host tools.',
    ])
    expect(added.exitCode, added.stderr).toBe(0)
    const id = added.stdout.split('\t')[0] ?? ''
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    try {
      await until(() => observedTools.length >= 2, 150_000, 'scheduled refused-tool continuation')
      await new Promise((r) => setTimeout(r, 2_000))
      expect(observedTools).toHaveLength(2)
      for (const names of observedTools) {
        expect(names).toContain('coding_command')
        // Same-name container bash is deliberately admitted, not a host shell.
        expect(names).toContain('bash')
        for (const name of ['read', 'edit', 'write', 'browser_navigate']) {
          expect(names).not.toContain(name)
        }
        expect(names.some((name) => name.startsWith('mcp__'))).toBe(false)
      }
      expect(
        toolReplies.some((text) => /read/i.test(text) && /not found|unknown tool/i.test(text)),
      ).toBe(true)
      expect(toolReplies.some((text) => text.includes(sentinel))).toBe(false)
      expect(readFileSync(marker, 'utf8')).toBe(sentinel)
      const response = await fetch(`${server.url}/api/triggers/${id}/dispatches?limit=5`, {
        headers: { authorization: `Bearer ${server.token}` },
      })
      expect(response.status).toBe(200)
      const history = (await response.json()) as ListTriggerDispatchesResponse
      expect(history.dispatches).toHaveLength(1)
      expect(history.dispatches[0]?.scheduledAt).toBe(due.getTime())
      expect(history.dispatches[0]?.status).toBe('succeeded')
      expect(history.dispatches[0]?.attemptCount).toBe(1)
      schedulingEvidence('scheduled-unadmitted-read', {
        providerRounds: observedTools.length,
        observedTools,
        refusedReplyObserved: toolReplies.some(
          (text) => /read/i.test(text) && /not found|unknown tool/i.test(text),
        ),
        sentinelDisclosed: toolReplies.some((text) => text.includes(sentinel)),
        dispatches: history.dispatches.map(({ id, scheduledAt, status, attemptCount }) => ({
          id,
          scheduledAt,
          status,
          attemptCount,
        })),
      })
    } catch (error) {
      // Retain the existing failure; collect only this disposable fixture's dispatch facts.
      if (process.env.BAZILION_TEST_SCHEDULING_EVIDENCE === '1') {
        const response = await fetch(`${server.url}/api/triggers/${id}/dispatches?limit=5`, {
          headers: { authorization: `Bearer ${server.token}` },
        })
        if (response.ok) {
          const history = (await response.json()) as ListTriggerDispatchesResponse
          schedulingEvidence('scheduled-unadmitted-read-failure', {
            providerRounds: observedTools.length,
            dispatches: history.dispatches.map(
              ({ id, scheduledAt, status, attemptCount, lastError }) => ({
                id,
                scheduledAt,
                status,
                attemptCount,
                failure: closedFailureReason(lastError),
              }),
            ),
          })
        }
      }
      throw error
    } finally {
      const disabled = await server.cli(['trigger', 'disable', id])
      expect(disabled.exitCode, disabled.stderr).toBe(0)
    }
    const count = observedTools.length
    await new Promise((r) => setTimeout(r, 1_000))
    expect(observedTools).toHaveLength(count)
  },
  180_000,
)

test.runIf(docker)(
  'scheduled approval grants are occurrence-specific: hold, approve, then hold and deny next cycle',
  async () => {
    const { writeFileSync } = await import('node:fs')
    const exported = await server.cli(['team', 'policy', 'export', 'content-cron'])
    expect(exported.exitCode, exported.stderr).toBe(0)
    const original = JSON.parse(exported.stdout) as TeamPolicyDocument
    const document = structuredClone(original)
    const edge = document.edges.find(
      (item) => item.sourceKind === 'user' && item.targetId === agentId('coordinator'),
    )
    expect(edge).toBeDefined()
    if (!edge) throw new Error('missing fixture ingress edge')
    edge.posture = 'approval_required'
    const policyFile = join(server.home, 'held-schedule-policy.json')
    writeFileSync(policyFile, JSON.stringify(document))
    const applied = await server.cli([
      'team',
      'policy',
      'import',
      'content-cron',
      policyFile,
      '--apply',
    ])
    expect(applied.exitCode, applied.stderr).toBe(0)
    const baseline = rounds.length
    mock.setFallback(router([reply('ONLY_APPROVED_OCCURRENCE_EXECUTED')], []))

    const first = Math.ceil((Date.now() + 5_000) / 60_000) * 60_000
    const second = first + 60_000
    let id = ''
    const headers = { authorization: `Bearer ${server.token}` }
    async function history() {
      const response = await fetch(`${server.url}/api/triggers/${id}/dispatches?limit=10`, {
        headers,
      })
      expect(response.status).toBe(200)
      return ((await response.json()) as ListTriggerDispatchesResponse).dispatches
    }
    async function pending(occurrence: number): Promise<CommunicationApproval> {
      const deadline = Date.now() + 100_000
      while (Date.now() < deadline) {
        const response = await fetch(
          `${server.url}/api/approvals?status=pending&teamId=content-cron`,
          { headers },
        )
        expect(response.status).toBe(200)
        const body = (await response.json()) as { approvals: CommunicationApproval[] }
        const item = body.approvals.find(
          (approval) =>
            approval.operation === 'scheduler_trigger' &&
            approval.attemptId === `${id}:${occurrence}`,
        )
        if (item) return item
        await new Promise((r) => setTimeout(r, 250))
      }
      const response = await fetch(`${server.url}/api/approvals?teamId=content-cron`, { headers })
      const body = (await response.json()) as { approvals: CommunicationApproval[] }
      throw new Error(
        JSON.stringify({
          reason: 'timed out waiting for durable scheduled approval',
          occurrence,
          approvals: body.approvals.map((a) => ({
            operation: a.operation,
            attemptId: a.attemptId,
            status: a.status,
          })),
          dispatches: (await history()).map((d) => ({
            scheduledAt: d.scheduledAt,
            status: d.status,
            attemptCount: d.attemptCount,
          })),
          providerRounds: rounds.length - baseline,
        }),
      )
    }
    async function settled(occurrence: number, status: 'succeeded' | 'failed') {
      const deadline = Date.now() + 20_000
      while (Date.now() < deadline) {
        const item = (await history()).find((dispatch) => dispatch.scheduledAt === occurrence)
        if (item?.status === status) return item
        await new Promise((r) => setTimeout(r, 250))
      }
      throw new Error('timed out waiting for scheduled approval outcome')
    }
    try {
      const added = await server.cli([
        'trigger',
        'add',
        agentId('coordinator'),
        '--cron',
        `${new Date(first).getUTCMinutes()},${new Date(second).getUTCMinutes()} * * * *`,
        '--message',
        'Approval-gated preparation; each occurrence needs its own grant.',
      ])
      expect(added.exitCode, added.stderr).toBe(0)
      id = added.stdout.split('\t')[0] ?? ''
      expect(id).toMatch(/^[0-9a-f-]{36}$/)
      const firstApproval = await pending(first)
      await new Promise((r) => setTimeout(r, 1_000))
      expect(rounds).toHaveLength(baseline)
      expect((await history()).find((d) => d.scheduledAt === first)).toMatchObject({
        status: 'pending',
        attemptCount: 0,
      })
      const allowed = await server.cli(['approval', 'approve', firstApproval.id, '--yes', '--json'])
      expect(allowed.exitCode, allowed.stderr).toBe(0)
      expect(JSON.parse(allowed.stdout)).toMatchObject({ status: 'delivered' })
      expect(await settled(first, 'succeeded')).toMatchObject({ attemptCount: 1 })
      expect(rounds).toHaveLength(baseline + 1)

      const secondApproval = await pending(second)
      expect(secondApproval.id).not.toBe(firstApproval.id)
      expect(secondApproval.attemptId).not.toBe(firstApproval.attemptId)
      await new Promise((r) => setTimeout(r, 1_000))
      expect(rounds).toHaveLength(baseline + 1)
      expect((await history()).find((d) => d.scheduledAt === second)).toMatchObject({
        status: 'pending',
        attemptCount: 0,
      })
      const denied = await server.cli(['approval', 'deny', secondApproval.id, '--yes', '--json'])
      expect(denied.exitCode, denied.stderr).toBe(0)
      expect(JSON.parse(denied.stdout)).toMatchObject({ status: 'denied' })
      expect(await settled(second, 'failed')).toMatchObject({ attemptCount: 1 })
      expect(await history()).toHaveLength(2)
      expect(rounds).toHaveLength(baseline + 1)
      schedulingEvidence('occurrence-specific-communication-approval', {
        providerRounds: rounds.length - baseline,
        approvals: [firstApproval, secondApproval].map(({ id, attemptId }) => ({ id, attemptId })),
        grantStatus: JSON.parse(allowed.stdout).status,
        denialStatus: JSON.parse(denied.stdout).status,
        dispatches: (await history()).map(({ id, scheduledAt, status, attemptCount }) => ({
          id,
          scheduledAt,
          status,
          attemptCount,
        })),
      })
    } finally {
      if (id) {
        const disabled = await server.cli(['trigger', 'disable', id])
        expect(disabled.exitCode, disabled.stderr).toBe(0)
      }
      const current = await server.cli(['team', 'policy', 'export', 'content-cron'])
      expect(current.exitCode, current.stderr).toBe(0)
      original.expectedRevision = (
        JSON.parse(current.stdout) as TeamPolicyDocument
      ).expectedRevision
      writeFileSync(policyFile, JSON.stringify(original))
      const restored = await server.cli([
        'team',
        'policy',
        'import',
        'content-cron',
        policyFile,
        '--apply',
      ])
      expect(restored.exitCode, restored.stderr).toBe(0)
    }
    await new Promise((r) => setTimeout(r, 1_000))
    expect(rounds).toHaveLength(baseline + 1)
  },
  240_000,
)
