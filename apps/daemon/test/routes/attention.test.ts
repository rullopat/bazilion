import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AttentionSummary } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

let home: string
let oldHome: string | undefined
let oldScheduler: string | undefined

beforeEach(() => {
  oldHome = process.env.BAZILION_HOME
  oldScheduler = process.env.BAZILION_SCHEDULER
  home = mkdtempSync(join(tmpdir(), 'bazilion-attention-route-'))
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
     VALUES ('agent', 'profile', 'Agent', 'idle', 'team', ?)`,
    [now],
  )
  ctx.db.raw.run(
    `INSERT INTO agent_reviews
       (id, agent_id, status, trigger_kind, last_error, created_at, updated_at)
     VALUES ('failed-review', 'agent', 'failed', 'manual', 'safe failure', ?, ?)`,
    [now - 2, now - 1],
  )
  ctx.db.raw.run(
    `INSERT INTO agent_reviews
       (id, agent_id, status, trigger_kind, proposal_count,
        finished_at, created_at, updated_at)
     VALUES ('complete-review', 'agent', 'completed', 'manual', 1, ?, ?, ?)`,
    [now, now, now],
  )
  ctx.db.raw.run(
    `INSERT INTO agent_lesson_proposals
       (id, review_id, agent_id, scope, text, evidence_json, status, created_at, updated_at)
     VALUES ('lesson', 'complete-review', 'agent', 'private', 'Lesson', '[]', 'pending', ?, ?)`,
    [now, now],
  )
  return {
    app: createApp(),
    auth: { authorization: `Bearer ${ctx.authToken}` },
  }
}

test('attention routes require auth and validate list filters', async () => {
  const { app, auth } = await fixture()
  expect((await app.request('/api/attention')).status).toBe(401)

  for (const [query, error] of [
    ['state=invalid', 'invalid attention state'],
    ['kind=invalid', 'invalid attention kind'],
    ['limit=201', 'attention limit must be between 1 and 200'],
  ]) {
    const response = await app.request(`/api/attention?${query}`, { headers: auth })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error })
  }

  const response = await app.request('/api/attention?state=open&kind=review_failure', {
    headers: auth,
  })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    items: [{ key: 'review_failure:failed-review', acknowledgeable: true }],
    degraded: [],
  })
})

test('acknowledgement lifecycle is idempotent and action-required work stays source-owned', async () => {
  const { app, auth } = await fixture()
  const reviewKey = encodeURIComponent('review_failure:failed-review')
  const lessonKey = encodeURIComponent('lesson_proposal:lesson')

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await app.request(`/api/attention/${reviewKey}/acknowledge`, {
      method: 'POST',
      headers: auth,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ item: { acknowledgedAt: expect.any(Number) } })
  }

  const history = await app.request('/api/attention?state=acknowledged', { headers: auth })
  expect(await history.json()).toMatchObject({ items: [{ key: 'review_failure:failed-review' }] })

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await app.request(`/api/attention/${reviewKey}/acknowledgement`, {
      method: 'DELETE',
      headers: auth,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ item: { acknowledgedAt: null } })
  }

  const protectedResponse = await app.request(`/api/attention/${lessonKey}/acknowledge`, {
    method: 'POST',
    headers: auth,
  })
  expect(protectedResponse.status).toBe(409)
  expect(await protectedResponse.json()).toEqual({
    error: 'action-required items must be resolved at their source',
  })

  const stale = await app.request('/api/attention/review_failure%3Amissing/acknowledge', {
    method: 'POST',
    headers: auth,
  })
  expect(stale.status).toBe(404)
  expect(await stale.json()).toEqual({
    error: 'attention source not found or no longer eligible',
  })
})

test('acknowledge-all and summary use the same open projection', async () => {
  const { app, auth } = await fixture()
  const before = await app.request('/api/attention/summary', { headers: auth })
  expect(await before.json()).toMatchObject({
    openTotal: 2,
    bySeverity: { action_required: 1, error: 1, warning: 0 },
  })

  const acknowledged = await app.request('/api/attention/acknowledge-all', {
    method: 'POST',
    headers: auth,
  })
  expect(await acknowledged.json()).toEqual({ acknowledged: 1 })

  const after = await app.request('/api/attention/summary', { headers: auth })
  expect(await after.json()).toMatchObject({
    openTotal: 1,
    bySeverity: { action_required: 1, error: 0, warning: 0 },
  })
  const open = await app.request('/api/attention?state=open', { headers: auth })
  expect(await open.json()).toMatchObject({ items: [{ key: 'lesson_proposal:lesson' }] })
})

test('a question or a command an Agent waits on comes first, and is answered, not acknowledged', async () => {
  const { app, auth } = await fixture()
  const { questionRegistry } = await import('../../src/lib/questions.ts')
  const { commandApprovalRegistry } = await import('../../src/lib/bash-approval.ts')
  const turn = new AbortController()
  const { question } = questionRegistry.ask(
    { agentId: 'agent', conversationId: 'conversation' },
    {
      questions: [
        {
          prompt: 'Which headline should the announcement use?',
          choices: [{ label: 'A' }, { label: 'B' }],
        },
      ],
    },
    turn.signal,
  )
  commandApprovalRegistry.begin(
    {
      id: 'approval',
      turnId: 'turn',
      toolCallId: 'call',
      agentId: 'agent',
      teamId: 'team',
      command: 'rm -rf build\necho done',
      risks: [
        {
          code: 'broad-destructive-operation',
          message: 'Recursively changes or deletes a broad filesystem target.',
          span: { start: 0, end: 12 },
        },
      ],
      mode: 'interactive',
    },
    turn.signal,
  )
  try {
    const list = (await (await app.request('/api/attention', { headers: auth })).json()) as {
      items: { kind: string }[]
    }
    const [first, second] = list.items
    // Both wait five minutes; the question was asked first, so it stops waiting first.
    expect(first).toMatchObject({
      key: `agent_question:${question.id}`,
      kind: 'agent_question',
      severity: 'action_required',
      agentName: 'Agent',
      teamName: 'Team',
      title: 'Agent is waiting for your answer',
      diagnostic: 'Which headline should the announcement use?',
      href: '/?agent=agent',
      acknowledgeable: false,
      acknowledgedAt: null,
      expiresAt: question.expiresAt,
    })
    expect(second).toMatchObject({
      key: 'command_approval:approval',
      kind: 'command_approval',
      title: 'Agent wants to run a command that needs your approval',
      diagnostic: 'rm -rf build: Recursively changes or deletes a broad filesystem target.',
    })
    expect(list.items.slice(2).map((item) => item.kind)).not.toContain('agent_question')

    const summary = (await (
      await app.request('/api/attention/summary', { headers: auth })
    ).json()) as AttentionSummary
    expect(summary.byKind).toMatchObject({ agent_question: 1, command_approval: 1 })
    expect(summary.bySeverity.action_required).toBe(3)

    const only = await app.request('/api/attention?kind=agent_question', { headers: auth })
    expect(((await only.json()) as { items: unknown[] }).items).toHaveLength(1)
    const history = await app.request('/api/attention?state=acknowledged', { headers: auth })
    expect(((await history.json()) as { items: unknown[] }).items).toEqual([])

    const key = encodeURIComponent(`agent_question:${question.id}`)
    const refused = await app.request(`/api/attention/${key}/acknowledge`, {
      method: 'POST',
      headers: auth,
    })
    expect(refused.status).toBe(409)
  } finally {
    turn.abort()
  }
  const after = (await (
    await app.request('/api/attention/summary', { headers: auth })
  ).json()) as AttentionSummary
  expect(after.byKind).toMatchObject({ agent_question: 0, command_approval: 0 })
})
