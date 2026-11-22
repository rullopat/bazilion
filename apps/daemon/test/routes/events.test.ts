import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LiveEvent } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

let home: string
let oldHome: string | undefined
let oldScheduler: string | undefined

beforeEach(() => {
  oldHome = process.env.BAZILION_HOME
  oldScheduler = process.env.BAZILION_SCHEDULER
  home = mkdtempSync(join(tmpdir(), 'bazilion-events-route-'))
  process.env.BAZILION_HOME = home
  process.env.BAZILION_SCHEDULER = 'off'
  vi.resetModules()
})

afterEach(async () => {
  try {
    ;(await import('../../src/lib/ctx.ts')).getCtx().db.close()
  } catch {}
  if (oldHome === undefined) delete process.env.BAZILION_HOME
  else process.env.BAZILION_HOME = oldHome
  if (oldScheduler === undefined) delete process.env.BAZILION_SCHEDULER
  else process.env.BAZILION_SCHEDULER = oldScheduler
  rmSync(home, { recursive: true, force: true })
  vi.resetModules()
})

async function fixture() {
  const { createApp } = await import('../../src/app.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const ctx = getCtx()
  const now = Date.now()
  ctx.db.raw.run(
    "INSERT INTO provider_state (provider_id, enabled, updated_at) VALUES ('lmstudio', 1, ?)",
    [now],
  )
  ctx.db.raw.run(
    "INSERT INTO provider_models (provider, model, added_at) VALUES ('lmstudio', 'qa', ?)",
    [now],
  )
  ctx.db.raw.run("INSERT INTO teams (id, name, created_at) VALUES ('team', 'Team', ?)", [now])
  ctx.db.raw.run(
    `INSERT INTO profiles (id, name, default_model, created_at, updated_at)
     VALUES ('profile', 'Profile', 'lmstudio:qa', ?, ?)`,
    [now, now],
  )
  ctx.db.raw.run(
    `INSERT INTO agents (id, profile_id, name, status, team_id, created_at)
     VALUES ('agent', 'profile', 'Mira', 'idle', 'team', ?)`,
    [now],
  )
  return { app: createApp(), auth: { authorization: `Bearer ${ctx.authToken}` } }
}

/** Read SSE events from a response body until `until` is satisfied. */
async function readEvents(
  body: ReadableStream<Uint8Array>,
  until: (events: LiveEvent[]) => boolean,
): Promise<LiveEvent[]> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const events: LiveEvent[] = []
  let buffer = ''
  while (!until(events)) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let end = buffer.indexOf('\n\n')
    while (end >= 0) {
      const block = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n')
      if (data) events.push(JSON.parse(data) as LiveEvent)
      end = buffer.indexOf('\n\n')
    }
  }
  await reader.cancel()
  return events
}

test('the event stream needs a credential', async () => {
  const { app } = await fixture()
  expect((await app.request('/api/events')).status).toBe(401)
})

test('the event stream sends the current state, then a question the moment it is asked', async () => {
  const { app, auth } = await fixture()
  const { questionRegistry } = await import('../../src/lib/questions.ts')
  const { liveFeed } = await import('../../src/lib/live.ts')
  const controller = new AbortController()
  const response = await app.request('/api/events', { headers: auth, signal: controller.signal })
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('text/event-stream')
  const body = response.body
  if (!body) throw new Error('no body')

  const turn = new AbortController()
  const asked = Date.now()
  const events = await readEvents(body, (seen) => {
    if (seen.length === 2) {
      // Both snapshots are in: nothing waits yet. Now the Agent asks.
      expect(seen.map((event) => event.type).sort()).toEqual(['activity', 'attention'])
      const attention = seen.find((event) => event.type === 'attention')
      expect(attention?.type === 'attention' && attention.waiting).toEqual([])
      questionRegistry.ask(
        { agentId: 'agent', conversationId: 'c1' },
        { prompt: 'Which headline?', choices: [{ label: 'A' }, { label: 'B' }] },
        turn.signal,
      )
    }
    return seen.some((event) => event.type === 'attention' && event.waiting.length > 0)
  })
  // Signalled, not left for the once-a-second check.
  expect(Date.now() - asked).toBeLessThan(900)

  const attention = events.findLast((event) => event.type === 'attention')
  if (attention?.type !== 'attention') throw new Error('no attention event')
  expect(attention.summary.byKind.agent_question).toBe(1)
  expect(attention.waiting[0]?.title).toBe('Mira is waiting for your answer')
  const activity = events.findLast((event) => event.type === 'activity')
  expect(activity?.type === 'activity' && activity.agents[0]?.questions).toBe(1)

  turn.abort()
  controller.abort()
  await vi.waitFor(() => expect(liveFeed().listeners).toBe(0))
})

test('a revoked token ends the stream', async () => {
  const { app } = await fixture()
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { webTokenRepo } = await import('../../src/core/index.ts')
  const { _setKeepaliveForTest } = await import('../../src/routes/events.ts')
  _setKeepaliveForTest(50)
  const device = webTokenRepo.create(getCtx().db, 'laptop')
  const response = await app.request('/api/events', {
    headers: { authorization: `Bearer ${device.token}` },
  })
  expect(response.status).toBe(200)
  const reader = response.body?.getReader()
  if (!reader) throw new Error('no body')
  await reader.read()
  webTokenRepo.revoke(getCtx().db, device.meta.id)
  const ended = (async () => {
    for (;;) if ((await reader.read()).done) return true
  })()
  await expect(ended).resolves.toBe(true)
})
