import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

let home: string
let oldHome: string | undefined
let oldScheduler: string | undefined
let oldGate: string | undefined
let oldLoopLimit: string | undefined

beforeEach(() => {
  oldHome = process.env.BAZILION_HOME
  oldScheduler = process.env.BAZILION_SCHEDULER
  oldGate = process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
  oldLoopLimit = process.env.BAZILION_AGENT_LOOP_MAX_HOPS
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
  if (oldLoopLimit === undefined) delete process.env.BAZILION_AGENT_LOOP_MAX_HOPS
  else process.env.BAZILION_AGENT_LOOP_MAX_HOPS = oldLoopLimit
  rmSync(home, { recursive: true, force: true })
  vi.resetModules()
})

test('agent message endpoint stops over-budget causal chains and exposes payload-free diagnostics', async () => {
  const { createApp } = await import('../../src/app.ts')
  const { createProfile, providerModelRepo, providerStateRepo, registerTeam, spawnAgent } =
    await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const ctx = getCtx()
  process.env.BAZILION_AGENT_LOOP_MAX_HOPS = '0'
  providerStateRepo.setEnabled(ctx.db, 'lmstudio', true)
  providerModelRepo.replace(ctx.db, 'lmstudio', ['model'])
  createProfile(ctx.db, ctx.paths, { id: 'p', defaultModel: 'm' })
  registerTeam(ctx.db, { id: 'default' }, ctx.paths)
  const a = spawnAgent(ctx.db, ctx.paths, { profileId: 'p', teamId: 'default' })
  const b = spawnAgent(ctx.db, ctx.paths, { profileId: 'p', teamId: 'default' })
  const app = createApp()
  const auth = { authorization: `Bearer ${ctx.authToken}`, 'content-type': 'application/json' }

  const first = await app.request(`/api/agents/${b.id}/messages`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ from: a.id, payload: { text: 'first payload' } }),
  })
  expect(first.status).toBe(201)
  const firstMessage = (await first.json()) as {
    id: string
    causalChainId: string
    causalHop: number
  }
  expect(firstMessage).toMatchObject({ causalChainId: firstMessage.id, causalHop: 0 })

  const blocked = await app.request(`/api/agents/${a.id}/messages`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      from: b.id,
      replyTo: firstMessage.id,
      payload: { text: 'secret blocked payload' },
    }),
  })
  expect(blocked.status).toBe(429)
  expect(await blocked.json()).toMatchObject({
    code: 'agent_loop_limit',
    event: { causalChainId: firstMessage.id, attemptedHop: 1, maxHops: 0 },
  })

  const diagnostics = await app.request(`/api/agents/${a.id}/loop-breaks`, { headers: auth })
  expect(diagnostics.status).toBe(200)
  const text = await diagnostics.text()
  expect(text).not.toContain('secret blocked payload')
  expect(JSON.parse(text)).toMatchObject({
    events: [{ causalChainId: firstMessage.id, fromAgentId: b.id, toAgentId: a.id }],
  })
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

test('HTTP and Telegram approval replays preserve identity while failures stay source-owned', async () => {
  const turns: Array<Record<string, unknown>> = []
  let protectedFailureAttemptId: string | null = null
  const downloadedMedia = {
    ok: true as const,
    data: 'bWVkaWEtYnl0ZXM=',
    mimeType: 'text/plain',
    name: 'approved.txt',
  }
  const downloadMediaBytes = vi.fn(async () => downloadedMedia)
  const sendTelegramMessage = vi.fn(async () => ({ message_id: 1 }))
  vi.doMock('../../src/lib/telegram/media.ts', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/lib/telegram/media.ts')>()
    return { ...actual, downloadMediaBytes }
  })
  vi.doMock('grammy', async (importOriginal) => {
    const actual = await importOriginal<typeof import('grammy')>()
    return {
      ...actual,
      Bot: class {
        readonly api = { sendMessage: sendTelegramMessage }
      },
    }
  })
  vi.doMock('../../src/lib/agent-turn.ts', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/lib/agent-turn.ts')>()
    return {
      ...actual,
      prepareAgentTurn: async (turn: Parameters<typeof actual.prepareAgentTurn>[0]) => {
        if (turn.invocation.kind === 'operator_http') return actual.prepareAgentTurn(turn)
        if (turn.invocation.authorization.attemptId === protectedFailureAttemptId) {
          throw new Error('preflight leaked APPROVAL_SECRET_SENTINEL')
        }
        turns.push(turn as unknown as Record<string, unknown>)
        return turn as never
      },
      runAgentTurn: () =>
        (async function* () {
          if (false as boolean) yield undefined
        })(),
    }
  })
  const { createApp } = await import('../../src/app.ts')
  const {
    authorizeInSnapshot,
    communicationApprovalRepo,
    createProfile,
    openSecrets,
    providerModelRepo,
    providerStateRepo,
    registerTeam,
    spawnAgent,
  } = await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const ctx = getCtx()
  process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
  providerStateRepo.setEnabled(ctx.db, 'lmstudio', true)
  providerModelRepo.replace(ctx.db, 'lmstudio', ['model'])
  createProfile(ctx.db, ctx.paths, { id: 'p', defaultModel: 'lmstudio:model' })
  registerTeam(ctx.db, { id: 'default' }, ctx.paths)
  const agent = spawnAgent(ctx.db, ctx.paths, { profileId: 'p', teamId: 'default' })
  openSecrets(ctx.db, ctx.authToken).set('TELEGRAM_BOT_TOKEN', 'telegram-test-token')
  ctx.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', ['default'])
  ctx.db.raw.run(
    `INSERT INTO team_policy_edges
       (team_id, source_kind, source_id, target_kind, target_id, posture)
     VALUES ('default', 'user', '', 'agent', ?, 'approval_required')`,
    [agent.id],
  )
  const app = createApp()
  const headers = {
    authorization: `Bearer ${ctx.authToken}`,
    'content-type': 'application/json',
  }
  const attachments = [{ name: 'secret.txt', mimeType: 'text/plain', data: 'c2VjcmV0' }]
  const held = await app.request(`/api/agents/${agent.id}/chat`, {
    method: 'POST',
    headers: { ...headers, 'x-request-id': 'stored-http-attempt' },
    body: JSON.stringify({ message: 'approved prompt', attachments }),
  })
  const heldBody = (await held.json()) as { approvalId: string }

  const approved = await app.request(`/api/approvals/${heldBody.approvalId}/approve`, {
    method: 'POST',
    headers,
    body: '{}',
  })
  expect(approved.status).toBe(200)
  expect(turns).toHaveLength(1)
  expect(turns[0]).toMatchObject({
    invocation: {
      kind: 'approval_delivery',
      bashApprovalMode: 'auto_deny',
      authorization: {
        origin: 'http_chat',
        attemptKind: 'http_chat_ingress',
        attemptId: 'stored-http-attempt',
        approvalId: heldBody.approvalId,
        agentId: agent.id,
      },
      turn: { agentId: agent.id, message: 'approved prompt', attachments },
    },
  })

  const telegramAttempt = {
    source: { kind: 'user' as const, teamId: 'default' },
    target: { kind: 'agent' as const, id: agent.id },
    origin: 'telegram_agent_topic',
    attemptKind: 'telegram_ingress',
    attemptId: '-100:77',
  }
  const telegramAuthorization = authorizeInSnapshot(ctx.db, telegramAttempt)
  expect(telegramAuthorization.decision).toBe('approval_required')
  const telegramMedia = {
    kind: 'document' as const,
    fileId: 'telegram-file-ref',
    fileName: 'original.txt',
    mimeType: 'text/plain',
    fileSize: 11,
  }
  const telegramApproval = communicationApprovalRepo.request(
    ctx.db,
    telegramAttempt,
    'user_to_agent',
    telegramAuthorization,
    'telegram_ingress',
    {
      agentId: agent.id,
      text: 'approved Telegram prompt',
      media: telegramMedia,
      chatId: -100,
      threadId: 42,
      messageId: 77,
    },
    { requester: 'telegram:11' },
  )
  expect(downloadMediaBytes).not.toHaveBeenCalled()
  expect(
    JSON.stringify(communicationApprovalRepo.get(ctx.db, telegramApproval.id, true)),
  ).not.toContain(downloadedMedia.data)
  let statusAtDownload: string | undefined
  downloadMediaBytes.mockImplementation(async () => {
    statusAtDownload = communicationApprovalRepo.get(ctx.db, telegramApproval.id)?.status
    return downloadedMedia
  })
  const telegramApproved = await app.request(`/api/approvals/${telegramApproval.id}/approve`, {
    method: 'POST',
    headers,
    body: '{}',
  })
  expect(telegramApproved.status).toBe(200)
  expect(statusAtDownload).toBe('delivering')
  expect(downloadMediaBytes).toHaveBeenCalledTimes(1)
  expect(sendTelegramMessage).toHaveBeenCalledWith(
    -100,
    'Communication approved. Processing now.',
    { message_thread_id: 42 },
  )
  expect(turns).toHaveLength(2)
  expect(turns[1]).toMatchObject({
    invocation: {
      kind: 'approval_delivery',
      bashApprovalMode: 'auto_deny',
      authorization: {
        origin: 'telegram_agent_topic',
        attemptKind: 'telegram_ingress',
        attemptId: '-100:77',
        approvalId: telegramApproval.id,
        agentId: agent.id,
      },
      turn: {
        agentId: agent.id,
        message: 'approved Telegram prompt',
        attachments: [
          {
            name: downloadedMedia.name,
            mimeType: downloadedMedia.mimeType,
            data: downloadedMedia.data,
          },
        ],
      },
    },
  })

  const corruptAttempt = {
    ...telegramAttempt,
    attemptId: '-100:78',
  }
  const corruptAuthorization = authorizeInSnapshot(ctx.db, corruptAttempt)
  const corruptApproval = communicationApprovalRepo.request(
    ctx.db,
    corruptAttempt,
    'user_to_agent',
    corruptAuthorization,
    'telegram_ingress',
    {
      agentId: agent.id,
      text: 'must not leave the Agent topic',
      media: null,
      chatId: -100,
      threadId: 42,
      messageId: 78,
    },
    { requester: 'telegram:11' },
  )
  ctx.db.raw.run('UPDATE communication_approvals SET payload_json = ? WHERE id = ?', [
    JSON.stringify({
      agentId: agent.id,
      text: 'must not leave the Agent topic',
      media: null,
      chatId: -100,
      messageId: 78,
    }),
    corruptApproval.id,
  ])
  const corruptReplay = await app.request(`/api/approvals/${corruptApproval.id}/approve`, {
    method: 'POST',
    headers,
    body: '{}',
  })
  expect(corruptReplay.status).toBe(500)
  expect(await corruptReplay.json()).toMatchObject({
    error: 'approval delivery failed',
    detail: 'approval_delivery_invalid: telegram_ingress_payload',
  })
  expect(communicationApprovalRepo.get(ctx.db, corruptApproval.id)).toMatchObject({
    status: 'delivery_failed',
    deliveryError: 'approval_delivery_invalid: telegram_ingress_payload',
  })
  expect(turns).toHaveLength(2)
  expect(downloadMediaBytes).toHaveBeenCalledTimes(1)

  const failedHeld = await app.request(`/api/agents/${agent.id}/chat`, {
    method: 'POST',
    headers: { ...headers, 'x-request-id': 'protected-preflight-failure' },
    body: JSON.stringify({ message: 'must fail safely' }),
  })
  const failedBody = (await failedHeld.json()) as { approvalId: string }
  protectedFailureAttemptId = 'protected-preflight-failure'
  const failedDelivery = await app.request(`/api/approvals/${failedBody.approvalId}/approve`, {
    method: 'POST',
    headers,
    body: '{}',
  })
  expect(failedDelivery.status).toBe(500)
  const failedText = await failedDelivery.text()
  expect(failedText).not.toContain('APPROVAL_SECRET_SENTINEL')
  expect(JSON.parse(failedText)).toEqual({
    error: 'approval delivery failed',
    detail: 'Approval delivery failed. Check Bazilion Config or bazilion doctor.',
  })
  expect(communicationApprovalRepo.get(ctx.db, failedBody.approvalId)).toMatchObject({
    status: 'delivery_failed',
    deliveryError: 'Approval delivery failed. Check Bazilion Config or bazilion doctor.',
  })

  const invalidHeld = await app.request(`/api/agents/${agent.id}/chat`, {
    method: 'POST',
    headers: { ...headers, 'x-request-id': 'invalid-stored-tuple' },
    body: JSON.stringify({ message: 'must not run' }),
  })
  const invalidBody = (await invalidHeld.json()) as { approvalId: string }
  ctx.db.raw.run('UPDATE communication_approvals SET payload_kind = ? WHERE id = ?', [
    'telegram_file',
    invalidBody.approvalId,
  ])
  const rejected = await app.request(`/api/approvals/${invalidBody.approvalId}/approve`, {
    method: 'POST',
    headers,
    body: '{}',
  })
  expect(rejected.status).toBe(500)
  expect(await rejected.json()).toMatchObject({
    error: 'approval delivery failed',
    detail: 'approval_delivery_invalid: tuple_not_allowed',
  })
  expect(communicationApprovalRepo.get(ctx.db, invalidBody.approvalId)).toMatchObject({
    status: 'delivery_failed',
    deliveryError: 'approval_delivery_invalid: tuple_not_allowed',
  })
  expect(turns).toHaveLength(2)
})
