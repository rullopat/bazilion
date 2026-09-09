import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createProfile, spawnAgent } from '../../src/core/index.ts'
import * as userQueue from '../../src/core/repos/user-queue.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'
import { seedRegisteredConversation } from '../fixtures/conversation.ts'

let env: TestEnv
let agentId: string
let priorPolicy: string | undefined
let priorSandbox: string | undefined

test('Telegram callback answers a live protected question through its canonical approval without queueing', async () => {
  const preflight = Object.freeze({ marker: 'question-preflight', paths: Object.freeze({}) })
  vi.doMock('../../src/lib/protected-execution.ts', () => ({
    prepareProtectedExecution: async () => preflight,
    consumePreparedProtectedExecution: () => {},
  }))
  vi.resetModules()
  const { createTrustedTurnInvocation } = await import('../../src/lib/turn-invocation.ts')
  const { prepareAgentTurn, releasePreparedAgentTurn } = await import(
    '../../src/lib/turn-preparation.ts'
  )
  const { questionServiceFor } = await import('../../src/lib/question-service.ts')
  const { installQuestionTransport } = await import('../../src/lib/telegram/question-transport.ts')
  const { routeUpdate } = await import('../../src/lib/telegram/routing.ts')
  const { approvalsRouter } = await import('../../src/routes/approvals.ts')
  const questions = await import('../../src/core/repos/questions.ts')
  const { setTelegramTopicId } = await import('../../src/core/repos/agents.ts')
  const acl = await import('../../src/core/repos/telegram-acl.ts')
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'question-fixture-bot')
  vi.stubEnv('TELEGRAM_CHAT_ID', '-100')
  setTelegramTopicId(env.db, agentId, 42)
  acl.add(env.db, { userId: 11, role: 'owner' })
  const conversationId = seedRegisteredConversation(env.db, env.paths, agentId).id
  const send = vi.fn(async () => ({ message_id: 50 + send.mock.calls.length }))
  const edit = vi.fn(async () => {})
  installQuestionTransport(() => ({
    db: env.db,
    authToken: 'test-auth-token',
    botToken: 'question-fixture-bot',
    send,
    edit,
  }))
  const prepared = await prepareAgentTurn({
    invocation: createTrustedTurnInvocation({
      kind: 'telegram',
      authorization: {
        origin: 'telegram_agent_topic',
        attemptKind: 'telegram_ingress',
        attemptId: '-100:77',
        requester: 'telegram:11',
        approvalPayloadKind: 'telegram_ingress',
        approvalPayload: {
          agentId,
          conversationId,
          text: 'ask',
          media: null,
          chatId: -100,
          threadId: 42,
          messageId: 77,
        },
      },
      turn: { agentId, conversationId, message: 'ask', attachments: [] },
      bashApprovalMode: 'auto_deny',
    }),
  })
  const host = questionServiceFor(env.db, env.paths, 'test-auth-token').attach(prepared)
  if (!host) throw new Error('Missing live Telegram question host')
  try {
    const waiting = host.ask('telegram-question', {
      prompt: 'Format?',
      choices: [{ label: 'Text' }, { label: 'JSON' }],
    })
    await vi.waitFor(() =>
      expect(questions.list(env.db, agentId)[0]?.deliveredAt).toEqual(expect.any(Number)),
    )
    const item = questions.list(env.db, agentId)[0]
    if (!item) throw new Error('Missing question')
    process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
    env.db.raw.run(
      "UPDATE team_policy_edges SET posture = 'approval_required' WHERE team_id = ? AND source_kind = 'user'",
      [env.teamId],
    )
    const api = {
      sendMessage: vi.fn(async () => ({ message_id: 90 })),
      answerCallbackQuery: vi.fn(async () => {}),
    } as unknown as import('../../src/lib/telegram/routing.ts').ReplyApi
    const deps = {
      db: env.db,
      paths: env.paths,
      authToken: 'test-auth-token',
      botToken: 'question-fixture-bot',
      chatId: -100,
      api,
    }
    const update = {
      update_id: 90,
      callback_query: {
        id: 'question-tap',
        from: { id: 11, is_bot: false, first_name: 'Operator' },
        chat_instance: 'test',
        data: `bq:${item.id}:1`,
        message: {
          message_id: 52,
          date: 1,
          message_thread_id: 42,
          chat: { id: -100, type: 'supergroup', title: 'Fixture' },
        },
      },
    } as import('grammy/types').Update
    expect(await routeUpdate(deps, update)).toEqual({ kind: 'question_reply', status: 'held' })
    expect(await routeUpdate(deps, update)).toEqual({ kind: 'question_reply', status: 'held' })
    const held = questions.get(env.db, agentId, item.id)
    expect(held?.answer).toBeNull()
    expect(userQueue.list(env.db, agentId).total).toBe(0)
    if (!held?.answerApprovalId) throw new Error('Missing answer approval')
    const approved = await approvalsRouter.request(`/${held.answerApprovalId}/approve`, {
      method: 'POST',
    })
    expect(approved.status).toBe(200)
    expect(await waiting).toMatchObject({ kind: 'answer', answer: { kind: 'choice', index: 1 } })
    await vi.waitFor(() => expect(edit).toHaveBeenCalledOnce())
    expect(userQueue.list(env.db, agentId).total).toBe(0)
  } finally {
    host.close()
    await releasePreparedAgentTurn(prepared)
    installQuestionTransport(null)
    vi.unstubAllEnvs()
  }
})

test.each([
  'policy_removed',
  'approval_denied',
  'owner_replaced',
] as const)('waiting question closes without another response when %s', async (change) => {
  const { createTrustedTurnInvocation } = await import('../../src/lib/turn-invocation.ts')
  const { prepareAgentTurn, releasePreparedAgentTurn } = await import(
    '../../src/lib/turn-preparation.ts'
  )
  const { QuestionService } = await import('../../src/lib/question-service.ts')
  const questions = await import('../../src/core/repos/questions.ts')
  const approvals = await import('../../src/core/repos/communicationApprovals.ts')
  const { registerAgent, unregisterAgent } = await import('../../src/lib/agent-cancel.ts')
  const prepared = await prepareAgentTurn({
    questionMode: 'web',
    invocation: createTrustedTurnInvocation({
      kind: 'operator_http',
      authorization: {
        origin: 'http_chat',
        attemptKind: 'http_chat_ingress',
        attemptId: randomUUID(),
        requester: 'user',
        agentId,
      },
      turn: { agentId, message: 'ask', attachments: [] },
      bashApprovalMode: 'auto_deny',
    }),
  })
  vi.useFakeTimers()
  process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
  if (change === 'approval_denied')
    env.db.raw.run("UPDATE team_policy_edges SET posture = 'approval_required' WHERE team_id = ?", [
      env.teamId,
    ])
  const service = new QuestionService(env.db, env.paths, 'test-auth-token')
  const host = service.attach(prepared)
  if (!host) throw new Error('Missing question host')
  try {
    const waiting = host.ask('recheck', {
      prompt: 'Format?',
      choices: [{ label: 'Text' }, { label: 'JSON' }],
    })
    const item = questions.list(env.db, agentId)[0]
    if (!item) throw new Error('Missing question')
    if (change === 'policy_removed')
      env.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', [env.teamId])
    else if (change === 'approval_denied') {
      if (!item.deliveryApprovalId) throw new Error('Missing hold')
      approvals.decide(env.db, item.deliveryApprovalId, 'deny', 'test-operator')
    } else {
      await releasePreparedAgentTurn(prepared)
      registerAgent(agentId, new AbortController())
    }
    await vi.advanceTimersByTimeAsync(1000)
    expect(await waiting).toMatchObject({
      kind: 'no_answer',
      reason: change === 'owner_replaced' ? 'worker_lost' : 'policy_denied',
    })
    expect(questions.get(env.db, agentId, item.id)).toMatchObject({
      status: 'cancelled',
      continuation: 'interrupted',
    })
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    host.close()
    await releasePreparedAgentTurn(prepared)
    if (change === 'owner_replaced') unregisterAgent(agentId)
    vi.useRealTimers()
  }
})

test('canonical approval routes release only a live question and its captured answer', async () => {
  const { createTrustedTurnInvocation } = await import('../../src/lib/turn-invocation.ts')
  const { prepareAgentTurn, releasePreparedAgentTurn } = await import(
    '../../src/lib/turn-preparation.ts'
  )
  const { questionServiceFor } = await import('../../src/lib/question-service.ts')
  const questions = await import('../../src/core/repos/questions.ts')
  const { approvalsRouter } = await import('../../src/routes/approvals.ts')
  const { questionsRouter } = await import('../../src/routes/questions.ts')
  const prepared = await prepareAgentTurn({
    questionMode: 'web',
    invocation: createTrustedTurnInvocation({
      kind: 'operator_http',
      authorization: {
        origin: 'http_chat',
        attemptKind: 'http_chat_ingress',
        attemptId: randomUUID(),
        requester: 'user',
        agentId,
      },
      turn: { agentId, message: 'ask', attachments: [] },
      bashApprovalMode: 'auto_deny',
    }),
  })
  process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
  env.db.raw.run("UPDATE team_policy_edges SET posture = 'approval_required' WHERE team_id = ?", [
    env.teamId,
  ])
  const service = questionServiceFor(env.db, env.paths, 'test-auth-token')
  const host = service.attach(prepared)
  expect(() => service.attach(prepared)).toThrow('already attached')
  if (!host) throw new Error('Expected live host')
  try {
    const waiting = host.ask('ask-approval', {
      prompt: 'Format?',
      choices: [{ label: 'Text' }, { label: 'JSON' }],
    })
    const item = questions.list(env.db, agentId)[0]
    if (!item?.deliveryApprovalId) throw new Error('Missing delivery hold')
    expect(item.deliveredAt).toBeNull()
    expect((await questionsRouter.request(`/${agentId}/questions/${item.id}`)).status).toBe(404)
    expect(await (await questionsRouter.request(`/${agentId}/questions`)).json()).toEqual({
      questions: [],
    })
    const delivery = await approvalsRouter.request(`/${item.deliveryApprovalId}/approve`, {
      method: 'POST',
    })
    expect(await delivery.json()).toMatchObject({ status: 'delivered' })
    expect(questions.get(env.db, agentId, item.id)?.deliveredAt).not.toBeNull()
    expect((await questionsRouter.request(`/${agentId}/questions/${item.id}`)).status).toBe(200)
    const response = {
      requestId: randomUUID(),
      conversationId: item.conversationId,
      answer: { kind: 'choice' as const, index: 1 },
    }
    const submit = (value: unknown) =>
      questionsRouter.request(`/${agentId}/questions/${item.id}/answer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(value),
      })
    expect((await submit({ ...response, conversationId: randomUUID() })).status).toBe(400)
    const heldResponse = await submit(response)
    expect(heldResponse.status).toBe(202)
    const held = (await heldResponse.json()) as {
      kind: string
      question: { answerApprovalId: string | null }
    }
    expect(held.kind).toBe('held')
    if (!held.question.answerApprovalId) throw new Error('Missing answer hold')
    const answer = await approvalsRouter.request(`/${held.question.answerApprovalId}/approve`, {
      method: 'POST',
    })
    expect(await answer.json()).toMatchObject({ status: 'delivered' })
    expect(await waiting).toMatchObject({ kind: 'answer', answer: response.answer })
    expect(await (await submit(response)).json()).toMatchObject({ kind: 'already_applied' })
    expect((await submit({ ...response, requestId: randomUUID() })).status).toBe(409)
    env.db.raw.exec('SAVEPOINT denied_question_read')
    env.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', [env.teamId])
    expect((await questionsRouter.request(`/${agentId}/questions/${item.id}`)).status).toBe(404)
    env.db.raw.exec('ROLLBACK TO denied_question_read')
    env.db.raw.exec('RELEASE denied_question_read')
    const next = host.ask('closed-approval', {
      prompt: 'Again?',
      choices: [{ label: 'A' }, { label: 'B' }],
    })
    const second = questions.list(env.db, agentId).find((q) => q.id !== item.id)
    if (!second?.deliveryApprovalId) throw new Error('Missing next hold')
    host.close()
    const stale = await approvalsRouter.request(`/${second.deliveryApprovalId}/approve`, {
      method: 'POST',
    })
    expect(stale.status).toBe(409)
    expect(await next).toMatchObject({ kind: 'no_answer', reason: 'worker_lost' })
  } finally {
    host.close()
    await releasePreparedAgentTurn(prepared)
  }
})

test('live question host resumes once and cannot move to a replacement Agent registration', async () => {
  const { createTrustedTurnInvocation } = await import('../../src/lib/turn-invocation.ts')
  const { prepareAgentTurn, releasePreparedAgentTurn } = await import(
    '../../src/lib/turn-preparation.ts'
  )
  const { QuestionService } = await import('../../src/lib/question-service.ts')
  const questions = await import('../../src/core/repos/questions.ts')
  const { registerAgent, unregisterAgent } = await import('../../src/lib/agent-cancel.ts')
  const prepared = await prepareAgentTurn({
    questionMode: 'web',
    invocation: createTrustedTurnInvocation({
      kind: 'operator_http',
      authorization: {
        origin: 'http_chat',
        attemptKind: 'http_chat_ingress',
        attemptId: randomUUID(),
        requester: 'user',
        agentId,
      },
      turn: { agentId, message: 'ask', attachments: [] },
      bashApprovalMode: 'auto_deny',
    }),
  })
  const service = new QuestionService(env.db, env.paths, 'test-auth-token')
  const host = service.attach(prepared)
  if (!host) throw new Error('Expected live question host')
  try {
    const waiting = host.ask('first', {
      prompt: 'Format?',
      choices: [{ label: 'Text' }, { label: 'JSON' }],
    })
    const item = questions.list(env.db, agentId)[0]
    if (!item) throw new Error('Missing question')
    expect(item.deliveredAt).not.toBeNull()
    const response = {
      requestId: randomUUID(),
      conversationId: item.conversationId,
      answer: { kind: 'choice' as const, index: 1 },
    }
    expect(service.respond(agentId, item.id, response).kind).toBe('accepted')
    expect(service.respond(agentId, item.id, response).kind).toBe('already_applied')
    expect(await waiting).toMatchObject({
      questionId: item.id,
      kind: 'answer',
      answer: response.answer,
    })
    expect(questions.get(env.db, agentId, item.id)?.continuation).toBe('unconfirmed')
    const next = host.ask('next', { prompt: 'Another?', choices: [{ label: 'A' }, { label: 'B' }] })
    const second = questions.list(env.db, agentId).find((q) => q.id !== item.id)
    if (!second) throw new Error('Missing next question')
    await releasePreparedAgentTurn(prepared)
    registerAgent(agentId, new AbortController())
    expect(() => service.ready(agentId, second.id)).toThrow('closed')
    host.close()
    expect(await next).toMatchObject({ kind: 'no_answer', reason: 'worker_lost' })
  } finally {
    host.close()
    unregisterAgent(agentId)
  }
})

test('foreground question support is independently bound and queued HTTP cannot inherit it', async () => {
  const { createTrustedTurnInvocation } = await import('../../src/lib/turn-invocation.ts')
  const { prepareAgentTurn, releasePreparedAgentTurn } = await import(
    '../../src/lib/turn-preparation.ts'
  )
  const invocation = createTrustedTurnInvocation({
    kind: 'operator_http',
    authorization: {
      origin: 'http_chat',
      attemptKind: 'http_chat_ingress',
      attemptId: randomUUID(),
      requester: 'user',
      agentId,
    },
    turn: { agentId, message: 'question route', attachments: [] },
    bashApprovalMode: 'auto_deny',
  })
  const prepared = await prepareAgentTurn({ invocation, questionMode: 'web' })
  expect(prepared.questionRoute).toEqual({ kind: 'web' })
  expect(prepared.invocation.bashApprovalMode).toBe('auto_deny')
  expect(Object.isFrozen(prepared.questionRoute)).toBe(true)
  await releasePreparedAgentTurn(prepared)
  const unsupported = await prepareAgentTurn({ invocation })
  expect(unsupported.questionRoute).toBeUndefined()
  await releasePreparedAgentTurn(unsupported)
})

test('queued preparation binds retained input and retains its reference when policy requires approval', async () => {
  const { createTrustedTurnInvocation } = await import('../../src/lib/turn-invocation.ts')
  const { prepareAgentTurn, releasePreparedAgentTurn } = await import(
    '../../src/lib/turn-preparation.ts'
  )
  const { CommunicationPendingError } = await import('../../src/lib/communication.ts')
  const target = seedRegisteredConversation(env.db, env.paths, agentId)
  const id = randomUUID()
  userQueue.accept(env.db, {
    id,
    agentId,
    teamId: env.teamId,
    conversationId: target.id,
    source: 'http',
    attemptId: id,
    provenance: { requester: 'user' },
    message: 'retained',
    attachments: [],
  })
  userQueue.claim(env.db, agentId)
  const invocation = (message: string) =>
    createTrustedTurnInvocation({
      kind: 'operator_http',
      authorization: {
        origin: 'http_chat',
        attemptKind: 'http_chat_ingress',
        attemptId: id,
        requester: 'user',
        agentId,
      },
      turn: { agentId, conversationId: target.id, message, attachments: [] },
      bashApprovalMode: 'auto_deny',
    })
  await expect(
    prepareAgentTurn({ queuedItemId: id, invocation: invocation('substituted') }),
  ).rejects.toThrow('binding changed')
  await expect(
    prepareAgentTurn({ queuedItemId: id, invocation: invocation('retained'), questionMode: 'web' }),
  ).rejects.toThrow('not eligible')
  const prepared = await prepareAgentTurn({ queuedItemId: id, invocation: invocation('retained') })
  await releasePreparedAgentTurn(prepared)
  process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
  env.db.raw.run(
    "UPDATE team_policy_edges SET posture = 'approval_required' WHERE team_id = ? AND source_kind = 'user' AND target_id = ?",
    [env.teamId, agentId],
  )
  try {
    await prepareAgentTurn({ queuedItemId: id, invocation: invocation('retained') })
    throw new Error('Expected approval')
  } catch (error) {
    expect(error).toBeInstanceOf(CommunicationPendingError)
    if (!(error instanceof CommunicationPendingError)) throw error
    expect(error.approval.payloadKind).toBe('queued_user')
    const row = env.db.raw
      .query<{ payload_json: string }, [string]>(
        'SELECT payload_json FROM communication_approvals WHERE id = ?',
      )
      .get(error.approval.id)
    expect(JSON.parse(row?.payload_json ?? 'null')).toEqual(
      userQueue.approvalReference(env.db, agentId, id),
    )
  }
})

beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, {
    id: 'turn-preparation-profile',
    defaultModel: 'openai-codex:gpt-5.6-sol',
    communicationDefaults: {
      userInput: true,
      userOutput: true,
      outsideTeamInput: false,
      outsideTeamOutput: false,
      peerDefault: 'allow_all',
    },
  })
  agentId = spawnAgent(env.db, env.paths, {
    profileId: 'turn-preparation-profile',
    teamId: env.teamId,
  }).id
  priorPolicy = process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
  priorSandbox = process.env.BAZILION_BASH_SANDBOX
  process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'off'
  process.env.BAZILION_BASH_SANDBOX = 'off'
  vi.resetModules()
  vi.doMock('../../src/lib/ctx.ts', () => ({
    getCtx: () => ({ db: env.db, paths: env.paths, authToken: 'test-auth-token' }),
  }))
})

afterEach(() => {
  if (priorPolicy === undefined) delete process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
  else process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = priorPolicy
  if (priorSandbox === undefined) delete process.env.BAZILION_BASH_SANDBOX
  else process.env.BAZILION_BASH_SANDBOX = priorSandbox
  vi.doUnmock('../../src/lib/ctx.ts')
  vi.doUnmock('../../src/lib/protected-execution.ts')
  vi.resetModules()
  env.cleanup()
})

test('prepared Agent turns are immutable, clone-resistant, and consumable exactly once', async () => {
  const { createTrustedTurnInvocation } = await import('../../src/lib/turn-invocation.ts')
  const {
    assertPreparedAgentTurn,
    consumePreparedAgentTurn,
    prepareAgentTurn,
    releasePreparedAgentTurn,
  } = await import('../../src/lib/turn-preparation.ts')
  const invocation = createTrustedTurnInvocation({
    kind: 'operator_http',
    authorization: {
      origin: 'http_chat',
      attemptKind: 'http_chat_ingress',
      attemptId: 'turn-preparation-1',
      requester: 'user',
      agentId,
    },
    turn: {
      agentId,
      message: 'exact message',
      attachments: [{ name: 'image.png', mimeType: 'image/png', data: 'aW1hZ2U=' }],
    },
    bashApprovalMode: 'auto_deny',
  })
  const prepared = await prepareAgentTurn({ invocation })

  try {
    expect(Object.isFrozen(prepared)).toBe(true)
    expect(Object.isFrozen(prepared.agent)).toBe(true)
    expect(Object.isFrozen(prepared.agent.agent)).toBe(true)
    expect(Object.isFrozen(prepared.images)).toBe(true)
    expect(Object.isFrozen(prepared.images[0])).toBe(true)
    expect(Reflect.set(prepared.agent.agent, 'name', 'Mutated')).toBe(false)
    expect(prepared.agent.agent.name).not.toBe('Mutated')
    expect(() => assertPreparedAgentTurn({ ...prepared })).toThrow(
      /not prepared by the trusted daemon boundary/,
    )

    expect(() => consumePreparedAgentTurn(prepared)).not.toThrow()
    expect(() => consumePreparedAgentTurn(prepared)).toThrow(/already been executed/)
  } finally {
    await releasePreparedAgentTurn(prepared)
  }
})

test('an internally created protected preflight is consumed before it leaves preparation', async () => {
  const preflight = Object.freeze({ marker: 'nominal-preflight', paths: Object.freeze({}) })
  let consumed = false
  vi.doMock('../../src/lib/protected-execution.ts', () => ({
    prepareProtectedExecution: async () => preflight,
    consumePreparedProtectedExecution: (value: unknown) => {
      if (value !== preflight) throw new Error('protected execution was not prepared by the daemon')
      if (consumed) throw new Error('protected execution preflight has already been consumed')
      consumed = true
    },
  }))
  vi.resetModules()
  const { createTrustedTurnInvocation } = await import('../../src/lib/turn-invocation.ts')
  const { prepareAgentTurn, releasePreparedAgentTurn } = await import(
    '../../src/lib/turn-preparation.ts'
  )
  const invocation = (attemptId: string) =>
    createTrustedTurnInvocation({
      kind: 'approval_delivery',
      authorization: {
        origin: 'http_chat',
        attemptKind: 'http_chat_ingress',
        attemptId,
        approvalId: `approval-${attemptId}`,
        agentId,
      },
      turn: { agentId, message: 'protected message', attachments: [] },
      bashApprovalMode: 'auto_deny',
    })

  const first = await prepareAgentTurn({ invocation: invocation('attempt-1') })
  expect(consumed).toBe(true)
  expect(first.protectedExecution).toBe(preflight)
  await releasePreparedAgentTurn(first)

  await expect(
    prepareAgentTurn({
      invocation: invocation('attempt-2'),
      protectedExecution: first.protectedExecution,
    }),
  ).rejects.toThrow(/already been consumed/)
})

test('cross-source busy rejection happens before Telegram final authorization', async () => {
  const preflight = Object.freeze({ marker: 'nominal-preflight', paths: Object.freeze({}) })
  vi.doMock('../../src/lib/protected-execution.ts', () => ({
    prepareProtectedExecution: async () => preflight,
    consumePreparedProtectedExecution: () => {},
  }))
  vi.resetModules()
  const { communicationDecisionMetrics } = await import('../../src/lib/communication.ts')
  const { registerAgent, unregisterAgent } = await import('../../src/lib/agent-cancel.ts')
  const { createTrustedTurnInvocation } = await import('../../src/lib/turn-invocation.ts')
  const { prepareAgentTurn, releasePreparedAgentTurn } = await import(
    '../../src/lib/turn-preparation.ts'
  )
  const conversationId = seedRegisteredConversation(env.db, env.paths, agentId).id
  const invocation = createTrustedTurnInvocation({
    kind: 'telegram',
    authorization: {
      origin: 'telegram_agent_topic',
      attemptKind: 'telegram_ingress',
      attemptId: '-100:77',
      approvalPayloadKind: 'telegram_ingress',
      approvalPayload: {
        agentId,
        conversationId,
        text: 'retained exact head',
        media: null,
        chatId: -100,
        threadId: 42,
        messageId: 77,
      },
      requester: 'telegram:11',
    },
    turn: { agentId, conversationId, message: 'retained exact head', attachments: [] },
    bashApprovalMode: 'auto_deny',
  })
  process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
  env.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', [env.teamId])
  env.db.raw.run(
    `INSERT INTO team_policy_edges
       (team_id, source_kind, source_id, target_kind, target_id, posture)
     VALUES (?, 'user', '', 'agent', ?, 'allow')`,
    [env.teamId, agentId],
  )
  const allowedBefore = communicationDecisionMetrics.allowed

  registerAgent(agentId, new AbortController())
  try {
    await expect(prepareAgentTurn({ invocation })).rejects.toThrow(/agent_turn_active/)
    expect(communicationDecisionMetrics.allowed).toBe(allowedBefore)
  } finally {
    unregisterAgent(agentId)
  }

  const prepared = await prepareAgentTurn({ invocation })
  expect(communicationDecisionMetrics.allowed).toBe(allowedBefore + 1)
  await releasePreparedAgentTurn(prepared)
})

test.each([
  'scheduled_trigger',
  'inbox_wake',
] as const)('a preclaimed %s lifecycle handoff can be prepared only once', async (kind) => {
  const preflight = Object.freeze({ marker: 'nominal-preflight', paths: Object.freeze({}) })
  vi.doMock('../../src/lib/protected-execution.ts', () => ({
    prepareProtectedExecution: async () => preflight,
    consumePreparedProtectedExecution: () => {},
  }))
  vi.resetModules()
  const { createPreclaimedTurn, createTrustedTurnInvocation } = await import(
    '../../src/lib/turn-invocation.ts'
  )
  const { prepareAgentTurn, releasePreparedAgentTurn } = await import(
    '../../src/lib/turn-preparation.ts'
  )
  const attemptId = kind === 'scheduled_trigger' ? 'trigger-1:1000' : `${agentId}:message-1`
  const releaseLease = vi.fn()
  const claim = createPreclaimedTurn({
    agentId,
    attemptId,
    controller: new AbortController(),
    releaseLease,
    registered: true,
  })
  const invocation = () =>
    createTrustedTurnInvocation(
      kind === 'scheduled_trigger'
        ? {
            kind,
            authorization: {
              origin: 'scheduler_trigger',
              attemptKind: 'scheduler_trigger',
              attemptId,
              agentId,
            },
            turn: { agentId, message: 'scheduled work', attachments: [] },
            claim,
            bashApprovalMode: 'auto_deny',
          }
        : {
            kind,
            authorization: {
              origin: 'scheduler_inbox',
              attemptKind: 'inbox_wake',
              attemptId,
              agentId,
            },
            turn: {
              agentId,
              message: 'inbox work',
              attachments: [],
              causalParentMessageId: 'message-1',
            },
            claim,
            bashApprovalMode: 'auto_deny',
          },
    )

  const first = await prepareAgentTurn({ invocation: invocation() })
  expect(releaseLease).toHaveBeenCalledTimes(1)
  await expect(prepareAgentTurn({ invocation: invocation() })).rejects.toThrow(
    /preclaimed Agent turn has already been prepared/,
  )
  expect(releaseLease).toHaveBeenCalledTimes(1)
  await releasePreparedAgentTurn(first)
})
