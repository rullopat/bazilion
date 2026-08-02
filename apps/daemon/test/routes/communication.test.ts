import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

let home: string
let oldHome: string | undefined
let oldScheduler: string | undefined
let oldGate: string | undefined

beforeEach(() => {
  oldHome = process.env.BAZILION_HOME
  oldScheduler = process.env.BAZILION_SCHEDULER
  oldGate = process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
  home = mkdtempSync(join(tmpdir(), 'bazilion-communication-route-'))
  process.env.BAZILION_HOME = home
  process.env.BAZILION_SCHEDULER = 'off'
  process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'off'
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
  if (oldGate === undefined) delete process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
  else process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = oldGate
  rmSync(home, { recursive: true, force: true })
  vi.resetModules()
})

test('authenticated evaluator is side-effect free and block history is filtered and cursor paginated', async () => {
  const { createApp } = await import('../../src/app.ts')
  const { createProfile, providerModelRepo, providerStateRepo, registerTeam, spawnAgent } =
    await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const ctx = getCtx()
  process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
  providerStateRepo.setEnabled(ctx.db, 'lmstudio', true)
  providerModelRepo.replace(ctx.db, 'lmstudio', ['model'])
  createProfile(ctx.db, ctx.paths, { id: 'p', defaultModel: 'm' })
  registerTeam(ctx.db, { id: 'default' }, ctx.paths)
  const a = spawnAgent(ctx.db, ctx.paths, { profileId: 'p', teamId: 'default' })
  const b = spawnAgent(ctx.db, ctx.paths, { profileId: 'p', teamId: 'default' })
  ctx.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', ['default'])
  const app = createApp()
  const auth = { authorization: `Bearer ${ctx.authToken}`, 'content-type': 'application/json' }

  expect(
    (
      await app.request('/api/communication/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
    ).status,
  ).toBe(401)
  const input = {
    source: { kind: 'agent', id: a.id },
    target: { kind: 'agent', id: b.id },
    origin: 'diagnostic',
    attemptKind: 'diagnostic',
    attemptId: 'one',
  }
  const evaluated = await app.request('/api/communication/evaluate', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify(input),
  })
  expect(evaluated.status).toBe(200)
  expect(await evaluated.json()).toMatchObject({ decision: 'deny', reasonCode: 'no_allow_edge' })
  expect(
    ctx.db.raw
      .query<{ count: number }, []>('SELECT COUNT(*) count FROM team_policy_block_events')
      .get()?.count,
  ).toBe(0)

  const deniedChat = await app.request(`/api/agents/${b.id}/chat`, {
    method: 'POST',
    headers: { ...auth, 'x-request-id': 'chat-denied' },
    body: JSON.stringify({
      message: 'private prompt',
      attachments: [{ name: 'secret.txt', mimeType: 'text/plain', data: 'c2VjcmV0' }],
    }),
  })
  expect(deniedChat.status).toBe(403)
  expect(await deniedChat.json()).toMatchObject({
    code: 'communication_denied',
    reasonCode: 'no_allow_edge',
    attemptKind: 'http_chat_ingress',
    attemptId: 'chat-denied',
  })
  expect(existsSync(join(b.dir, 'uploads'))).toBe(false)
  const history = await app.request(`/api/agents/${b.id}/sessions/messages`, { headers: auth })
  expect(history.status).toBe(200)
  expect(await history.json()).toMatchObject({ messages: [] })

  for (const id of ['one', 'two']) {
    const response = await app.request(`/api/agents/${b.id}/messages`, {
      method: 'POST',
      headers: { ...auth, 'Idempotency-Key': id },
      body: JSON.stringify({ from: a.id, payload: { text: `secret-${id}` } }),
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      decision: 'deny',
      reasonCode: 'no_allow_edge',
      attemptKind: 'http_agent_message',
      attemptId: id,
    })
  }
  const page1 = await app.request('/api/teams/default/policy/blocks?limit=1', { headers: auth })
  expect(page1.status).toBe(200)
  const first = (await page1.json()) as {
    blocks: Array<{ reason_code: string; origin: string }>
    nextCursor: string
  }
  expect(first.blocks).toHaveLength(1)
  expect(first.blocks[0]).toMatchObject({
    reason_code: 'no_allow_edge',
    origin: 'http_agent_message',
  })
  expect(JSON.stringify(first)).not.toContain('secret-')
  const page2 = await app.request(
    `/api/teams/default/policy/blocks?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`,
    { headers: auth },
  )
  expect(((await page2.json()) as { blocks: unknown[] }).blocks).toHaveLength(1)
  const filtered = await app.request('/api/teams/default/policy/blocks?reasonCode=agent_archived', {
    headers: auth,
  })
  expect(((await filtered.json()) as { blocks: unknown[] }).blocks).toEqual([])
  const matching = await app.request(
    `/api/teams/default/policy/blocks?source=${a.id}&target=${b.id}&channel=same_team&origin=http_agent_message&reasonCode=no_allow_edge&from=0&to=${Date.now() + 1_000}`,
    { headers: auth },
  )
  expect(((await matching.json()) as { blocks: unknown[] }).blocks).toHaveLength(2)
  const wrongSource = await app.request('/api/teams/default/policy/blocks?source=missing', {
    headers: auth,
  })
  expect(((await wrongSource.json()) as { blocks: unknown[] }).blocks).toEqual([])
  expect(
    (
      await app.request('/api/teams/default/policy/blocks?from=not-a-time', {
        headers: auth,
      })
    ).status,
  ).toBe(400)
})

test('approval API is authenticated, list-private, idempotent, and delivers one Agent message', async () => {
  const { createApp } = await import('../../src/app.ts')
  const { createProfile, providerModelRepo, providerStateRepo, registerTeam, spawnAgent } =
    await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const ctx = getCtx()
  process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
  providerStateRepo.setEnabled(ctx.db, 'lmstudio', true)
  providerModelRepo.replace(ctx.db, 'lmstudio', ['model'])
  createProfile(ctx.db, ctx.paths, { id: 'p', defaultModel: 'm' })
  registerTeam(ctx.db, { id: 'default' }, ctx.paths)
  const source = spawnAgent(ctx.db, ctx.paths, { profileId: 'p', teamId: 'default' })
  const target = spawnAgent(ctx.db, ctx.paths, { profileId: 'p', teamId: 'default' })
  ctx.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', ['default'])
  ctx.db.raw.run(
    `INSERT INTO team_policy_edges
       (team_id, source_kind, source_id, target_kind, target_id, posture)
     VALUES ('default', 'agent', ?, 'agent', ?, 'approval_required')`,
    [source.id, target.id],
  )
  const app = createApp()
  const auth = { authorization: `Bearer ${ctx.authToken}`, 'content-type': 'application/json' }
  expect((await app.request('/api/approvals')).status).toBe(401)

  const request = () =>
    app.request(`/api/agents/${target.id}/messages`, {
      method: 'POST',
      headers: { ...auth, 'Idempotency-Key': 'approval-message' },
      body: JSON.stringify({ from: source.id, payload: { text: 'sensitive approval text' } }),
    })
  const pending = await request()
  expect(pending.status).toBe(202)
  const pendingBody = (await pending.json()) as { approvalId: string }
  expect((await request()).status).toBe(202)
  expect(
    ctx.db.raw.query<{ count: number }, []>('SELECT COUNT(*) count FROM messages').get()?.count,
  ).toBe(0)

  const list = await app.request('/api/approvals', { headers: auth })
  const listText = await list.text()
  expect(listText).not.toContain('sensitive approval text')
  expect(JSON.parse(listText)).toMatchObject({
    approvals: [{ id: pendingBody.approvalId, status: 'pending' }],
  })
  const detail = await app.request(`/api/approvals/${pendingBody.approvalId}`, { headers: auth })
  expect(await detail.json()).toMatchObject({
    payload: { from: source.id, to: target.id },
    events: [{ event: 'requested' }],
  })
  const approve = () =>
    app.request(`/api/approvals/${pendingBody.approvalId}/approve`, {
      method: 'POST',
      headers: auth,
      body: '{}',
    })
  const decisions = await Promise.all([approve(), approve()])
  expect(decisions.map((item) => item.status).sort()).toEqual([200, 409])
  const approved = decisions.find((item) => item.status === 200)
  expect(await approved?.json()).toMatchObject({ status: 'delivered' })
  expect(
    ctx.db.raw.query<{ count: number }, []>('SELECT COUNT(*) count FROM messages').get()?.count,
  ).toBe(1)
  const duplicate = await approve()
  expect(duplicate.status).toBe(409)
  expect(
    ctx.db.raw.query<{ count: number }, []>('SELECT COUNT(*) count FROM messages').get()?.count,
  ).toBe(1)
})

test('approving a scheduled occurrence grants its pending dispatch without running the turn', async () => {
  const { createApp } = await import('../../src/app.ts')
  const {
    communicationApprovalRepo,
    createProfile,
    providerModelRepo,
    providerStateRepo,
    registerTeam,
    spawnAgent,
    triggerDispatchRepo,
    triggerRepo,
  } = await import('../../src/core/index.ts')
  const { claimSchedulerTrigger } = await import('../../src/lib/communication.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const ctx = getCtx()
  process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
  providerStateRepo.setEnabled(ctx.db, 'lmstudio', true)
  providerModelRepo.replace(ctx.db, 'lmstudio', ['model'])
  createProfile(ctx.db, ctx.paths, { id: 'p', defaultModel: 'lmstudio:model' })
  registerTeam(ctx.db, { id: 'default' }, ctx.paths)
  const agent = spawnAgent(ctx.db, ctx.paths, { profileId: 'p', teamId: 'default' })
  ctx.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', ['default'])
  ctx.db.raw.run(
    `INSERT INTO team_policy_edges
       (team_id, source_kind, source_id, target_kind, target_id, posture)
     VALUES ('default', 'user', '', 'agent', ?, 'approval_required')`,
    [agent.id],
  )
  const trigger = triggerRepo.insert(ctx.db, {
    agentId: agent.id,
    kind: 'interval',
    intervalSec: 60,
    cronExpr: null,
    message: 'approved scheduled work',
  })
  const dispatch = triggerDispatchRepo.materialize(ctx.db, {
    triggerId: trigger.id,
    agentId: agent.id,
    scheduledAt: Date.now(),
  })
  const claim = claimSchedulerTrigger(ctx.db, {
    dispatchId: dispatch.id,
    triggerId: trigger.id,
    agentId: agent.id,
    occurrence: dispatch.scheduledAt,
    materialized: true,
  })
  if (claim.kind !== 'approval_pending') throw new Error('expected pending approval')

  const app = createApp()
  const response = await app.request(`/api/approvals/${claim.approval.id}/approve`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${ctx.authToken}`,
      'content-type': 'application/json',
    },
    body: '{}',
  })

  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ status: 'delivered' })
  expect(communicationApprovalRepo.get(ctx.db, claim.approval.id)).toMatchObject({
    status: 'delivered',
  })
  expect(triggerDispatchRepo.get(ctx.db, dispatch.id)).toMatchObject({
    status: 'pending',
    attemptCount: 0,
  })
  expect(readdirSync(join(agent.dir, 'sessions'))).toEqual([])
})

test('approval-required chat holds text and attachment before persistence or turn start', async () => {
  const { createApp } = await import('../../src/app.ts')
  const { createProfile, providerModelRepo, providerStateRepo, registerTeam, spawnAgent } =
    await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const ctx = getCtx()
  process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
  providerStateRepo.setEnabled(ctx.db, 'lmstudio', true)
  providerModelRepo.replace(ctx.db, 'lmstudio', ['model'])
  createProfile(ctx.db, ctx.paths, { id: 'p', defaultModel: 'lmstudio:model' })
  registerTeam(ctx.db, { id: 'default' }, ctx.paths)
  const agent = spawnAgent(ctx.db, ctx.paths, { profileId: 'p', teamId: 'default' })
  ctx.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', ['default'])
  ctx.db.raw.run(
    `INSERT INTO team_policy_edges
       (team_id, source_kind, source_id, target_kind, target_id, posture)
     VALUES ('default', 'user', '', 'agent', ?, 'approval_required')`,
    [agent.id],
  )
  const app = createApp()
  const response = await app.request(`/api/agents/${agent.id}/chat`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${ctx.authToken}`,
      'content-type': 'application/json',
      'x-request-id': 'held-chat',
    },
    body: JSON.stringify({
      message: 'held prompt',
      attachments: [{ name: 'secret.txt', mimeType: 'text/plain', data: 'c2VjcmV0' }],
    }),
  })
  expect(response.status).toBe(202)
  expect(await response.json()).toMatchObject({
    code: 'communication_pending',
    decision: 'approval_required',
    status: 'pending',
  })
  expect(existsSync(join(agent.dir, 'uploads'))).toBe(false)
  expect(existsSync(join(agent.dir, 'sessions'))).toBe(true)
  expect(readdirSync(join(agent.dir, 'sessions'))).toEqual([])
  expect(
    ctx.db.raw
      .query<{ count: number }, []>('SELECT COUNT(*) count FROM communication_approvals')
      .get()?.count,
  ).toBe(1)
})
