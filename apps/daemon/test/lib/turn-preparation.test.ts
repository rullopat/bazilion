import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createProfile, spawnAgent } from '../../src/core/index.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
let agentId: string
let priorPolicy: string | undefined
let priorSandbox: string | undefined

beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, {
    id: 'turn-preparation-profile',
    defaultModel: 'openai-codex:gpt-5.6-sol',
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
    releasePreparedAgentTurn(prepared)
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
  releasePreparedAgentTurn(first)

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
  const invocation = createTrustedTurnInvocation({
    kind: 'telegram',
    authorization: {
      origin: 'telegram_agent_topic',
      attemptKind: 'telegram_ingress',
      attemptId: '-100:77',
      approvalPayloadKind: 'telegram_ingress',
      approvalPayload: {
        agentId,
        text: 'retained exact head',
        media: null,
        chatId: -100,
        threadId: 42,
        messageId: 77,
      },
      requester: 'telegram:11',
    },
    turn: { agentId, message: 'retained exact head', attachments: [] },
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
  releasePreparedAgentTurn(prepared)
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
  releasePreparedAgentTurn(first)
})
