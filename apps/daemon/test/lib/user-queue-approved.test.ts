import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { CommunicationApprovalDetail } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { pauseRestoredUserQueue } from '../../../cli/src/backup-queue-recovery.ts'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { openDb } from '../../src/core/db/client.ts'
import { authorizeInSnapshot } from '../../src/core/index.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import { setTelegramTopicId } from '../../src/core/repos/agents.ts'
import * as approvals from '../../src/core/repos/communicationApprovals.ts'
import * as conversations from '../../src/core/repos/conversations.ts'
import * as telegramAcl from '../../src/core/repos/telegram-acl.ts'
import * as queue from '../../src/core/repos/user-queue.ts'
import { registerAgent, unregisterAgent } from '../../src/lib/agent-cancel.ts'
import { _resetOutboundQueueForTest } from '../../src/lib/telegram/outbound-queue.ts'
import { captureTelegramQueueBinding } from '../../src/lib/telegram/queue-binding.ts'
import { installQueueNoticeTransport } from '../../src/lib/telegram/queue-notice.ts'
import { enqueueHttpInput, enqueueTelegramInput } from '../../src/lib/user-queue-admission.ts'
import {
  assertQueuedApprovalReady,
  deliverQueuedApproval,
} from '../../src/lib/user-queue-approved.ts'
import { drainUserQueueHead } from '../../src/lib/user-queue-drain.ts'
import { startUserQueuePump } from '../../src/lib/user-queue-pump.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'
import { seedRegisteredConversation } from '../fixtures/conversation.ts'

let env: TestEnv
let agentId: string
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), run: vi.fn(), release: vi.fn() }))
vi.mock('../../src/lib/ctx.ts', () => ({
  getCtx: () => ({ db: env.db, paths: env.paths, authToken: 'test' }),
}))
vi.mock('../../src/lib/agent-turn.ts', () => ({
  prepareAgentTurn: mocks.prepare,
  runAgentTurn: mocks.run,
}))
vi.mock('../../src/lib/turn-preparation.ts', () => ({ releasePreparedAgentTurn: mocks.release }))
beforeEach(() => {
  env = makeTestEnv()
  vi.stubEnv('BAZILION_TEAM_POLICY_ENFORCEMENT', 'on')
  createProfile(env.db, env.paths, {
    id: 'queue',
    defaultModel: 'lmstudio:test',
    communicationDefaults: {
      userInput: true,
      userOutput: true,
      outsideTeamInput: false,
      outsideTeamOutput: false,
      peerDefault: 'allow_all',
    },
  })
  agentId = spawnAgent(env.db, env.paths, { profileId: 'queue', teamId: env.teamId }).id
  env.db.raw.run(
    "UPDATE team_policy_edges SET posture = 'approval_required' WHERE team_id = ? AND source_kind = 'user' AND target_id = ?",
    [env.teamId, agentId],
  )
  mocks.prepare.mockReset().mockResolvedValue({})
  mocks.release.mockReset()
  mocks.run.mockReset().mockImplementation(async function* () {
    yield { kind: 'done', messages: [] }
  })
})
afterEach(() => {
  installQueueNoticeTransport(null)
  _resetOutboundQueueForTest()
  vi.useRealTimers()
  unregisterAgent(agentId)
  vi.unstubAllEnvs()
  env.cleanup()
})

async function held() {
  const item = await enqueueHttpInput(agentId, {
    requestId: randomUUID(),
    expectedSelection: conversations.selection(env.db, agentId),
    message: 'held text',
    attachments: [{ name: 'original.txt', mimeType: 'text/plain', data: 'eA==' }],
  })
  if (!item.approvalId) throw new Error('Expected hold')
  const approval = approvals.get(env.db, item.approvalId, true)
  if (!approval || !('payload' in approval)) throw new Error('Expected approval detail')
  return { item, approval }
}
function claim(approval: CommunicationApprovalDetail) {
  return approvals.claimDelivery(env.db, approval.id, 'test', (row) =>
    authorizeInSnapshot(env.db, {
      source: row.source,
      target: row.target,
      origin: row.origin,
      attemptKind: row.attemptKind,
      attemptId: row.attemptId,
    }),
  )
}
test('pump drains with scheduler disabled and does not overlap or claim after stop', async () => {
  vi.useFakeTimers()
  vi.stubEnv('BAZILION_SCHEDULER', 'off')
  env.db.raw.run("UPDATE team_policy_edges SET posture = 'allow' WHERE team_id = ?", [env.teamId])
  await enqueueHttpInput(agentId, {
    requestId: randomUUID(),
    expectedSelection: conversations.selection(env.db, agentId),
    message: 'first',
  })
  const second = await enqueueHttpInput(agentId, {
    requestId: randomUUID(),
    expectedSelection: conversations.selection(env.db, agentId),
    message: 'second',
  })
  let finish!: () => void
  const barrier = new Promise<void>((resolve) => {
    finish = resolve
  })
  mocks.run.mockImplementation(async function* () {
    await barrier
    yield { kind: 'done', messages: [] }
  })
  const pump = startUserQueuePump()
  try {
    await vi.advanceTimersByTimeAsync(5_000)
    expect(mocks.run).toHaveBeenCalledTimes(1)
    const stopped = pump.stop()
    finish()
    await stopped
    await vi.advanceTimersByTimeAsync(5_000)
    expect(queue.get(env.db, agentId, second.id)?.status).toBe('pending')
    expect(mocks.run).toHaveBeenCalledTimes(1)
  } finally {
    finish()
    await pump.stop()
  }
})

test('ordinary dispatcher respects busy admission and completes FIFO input once', async () => {
  env.db.raw.run("UPDATE team_policy_edges SET posture = 'allow' WHERE team_id = ?", [env.teamId])
  const first = await enqueueHttpInput(agentId, {
    requestId: randomUUID(),
    expectedSelection: conversations.selection(env.db, agentId),
    message: 'first',
  })
  const second = await enqueueHttpInput(agentId, {
    requestId: randomUUID(),
    expectedSelection: conversations.selection(env.db, agentId),
    message: 'second',
  })
  registerAgent(agentId, new AbortController())
  expect(await drainUserQueueHead(agentId)).toBe(false)
  expect(queue.get(env.db, agentId, first.id)?.status).toBe('pending')
  unregisterAgent(agentId)
  expect(await drainUserQueueHead(agentId)).toBe(true)
  expect(queue.get(env.db, agentId, first.id)?.status).toBe('completed')
  expect(queue.get(env.db, agentId, second.id)?.status).toBe('pending')
  expect(mocks.prepare.mock.calls[0]?.[0]).toMatchObject({
    queuedItemId: first.id,
    invocation: {
      kind: 'operator_http',
      turn: { message: 'first', conversationId: first.conversationId },
    },
  })
  expect(await drainUserQueueHead(agentId)).toBe(true)
  expect(await drainUserQueueHead(agentId)).toBe(false)
  expect(mocks.run).toHaveBeenCalledTimes(2)
})

test('a non-busy failure containing the busy code is terminal and does not stall either Agent', async () => {
  const other = spawnAgent(env.db, env.paths, { profileId: 'queue', teamId: env.teamId }).id
  env.db.raw.run("UPDATE team_policy_edges SET posture = 'allow' WHERE team_id = ?", [env.teamId])
  const add = (id: string, message: string) =>
    enqueueHttpInput(id, {
      requestId: randomUUID(),
      expectedSelection: conversations.selection(env.db, id),
      message,
    })
  const failed = await add(agentId, 'fails before execution')
  const next = await add(agentId, 'later input')
  const independent = await add(other, 'independent Agent')
  mocks.prepare.mockRejectedValueOnce(
    new Error(`transport failure mentions agent_turn_active: ${agentId}`),
  )
  await drainUserQueueHead(agentId)
  expect(queue.get(env.db, agentId, failed.id)?.status).toBe('failed')
  await drainUserQueueHead(other)
  expect(queue.get(env.db, other, independent.id)?.status).toBe('completed')
  expect(queue.get(env.db, agentId, next.id)?.status).toBe('pending')
  await drainUserQueueHead(agentId)
  expect(queue.get(env.db, agentId, next.id)?.status).toBe('completed')
  expect(mocks.run).toHaveBeenCalledTimes(2)
})

test('canonical claim delivers exact retained bytes and target once', async () => {
  const { item, approval } = await held()
  await expect(deliverQueuedApproval(approval)).rejects.toThrow('not claimed')
  const claimed = claim(approval)
  await deliverQueuedApproval(claimed)
  expect(mocks.prepare.mock.calls[0]?.[0].invocation).toMatchObject({
    kind: 'approval_delivery',
    bashApprovalMode: 'auto_deny',
    turn: {
      agentId,
      conversationId: item.conversationId,
      message: 'held text',
      attachments: [{ name: 'original.txt', mimeType: 'text/plain', data: 'eA==' }],
    },
  })
  expect(queue.get(env.db, agentId, item.id)?.status).toBe('completed')
  await expect(deliverQueuedApproval(claimed)).rejects.toThrow()
  expect(mocks.run).toHaveBeenCalledTimes(1)
})

test.each([
  'ordinary',
  'approved',
] as const)('Telegram %s queue dispatch keeps its protected origin and captured target', async (kind) => {
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-bot')
  vi.stubEnv('TELEGRAM_CHAT_ID', '-100')
  telegramAcl.add(env.db, { userId: 11, role: 'owner' })
  setTelegramTopicId(env.db, agentId, 42)
  const target = seedRegisteredConversation(env.db, env.paths, agentId)
  const binding = captureTelegramQueueBinding(env.db, 'test', {
    origin: 'telegram_agent_topic',
    attemptKind: 'telegram_ingress',
    attemptId: '-100:5',
    requester: 'telegram:11',
    approvalPayloadKind: 'telegram_ingress',
    approvalPayload: {
      agentId,
      conversationId: target.id,
      chatId: -100,
      threadId: 42,
      messageId: 5,
      text: 'Telegram retained',
      media: null,
    },
  })
  if (kind === 'ordinary')
    env.db.raw.run("UPDATE team_policy_edges SET posture = 'allow' WHERE team_id = ?", [env.teamId])
  const item = await enqueueTelegramInput(binding, 'Telegram retained', [])
  if (kind === 'ordinary') await drainUserQueueHead(agentId)
  else {
    if (!item.approvalId) throw new Error('Missing approval')
    const approval = approvals.get(env.db, item.approvalId, true)
    if (!approval || !('payload' in approval)) throw new Error('Missing detail')
    await deliverQueuedApproval(claim(approval))
  }
  expect(mocks.prepare.mock.calls[0]?.[0].invocation).toMatchObject({
    kind: kind === 'ordinary' ? 'telegram' : 'approval_delivery',
    authorization: {
      origin: 'telegram_agent_topic',
      attemptKind: 'telegram_ingress',
      attemptId: '-100:5',
    },
    turn: { agentId, conversationId: target.id, message: 'Telegram retained' },
    bashApprovalMode: 'auto_deny',
  })
  expect(queue.get(env.db, agentId, item.id)?.status).toBe('completed')
  expect(mocks.run).toHaveBeenCalledTimes(1)
})
test('protected preflight failure sends one bounded secret-free owning-topic notice', async () => {
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-bot')
  vi.stubEnv('TELEGRAM_CHAT_ID', '-100')
  telegramAcl.add(env.db, { userId: 11, role: 'owner' })
  setTelegramTopicId(env.db, agentId, 42)
  env.db.raw.run("UPDATE team_policy_edges SET posture = 'allow' WHERE team_id = ?", [env.teamId])
  const target = seedRegisteredConversation(env.db, env.paths, agentId)
  const binding = captureTelegramQueueBinding(env.db, 'test', {
    origin: 'telegram_agent_topic',
    attemptKind: 'telegram_ingress',
    attemptId: '-100:5',
    requester: 'telegram:11',
    approvalPayloadKind: 'telegram_ingress',
    approvalPayload: {
      agentId,
      conversationId: target.id,
      chatId: -100,
      threadId: 42,
      messageId: 5,
      text: 'Private instruction',
      media: null,
    },
  })
  const item = await enqueueTelegramInput(binding, 'Private instruction', [])
  const secret = 'TELEGRAM_PREFLIGHT_SECRET_SENTINEL'
  mocks.prepare.mockRejectedValueOnce(new Error(`Docker unavailable: ${secret}`))
  const send = vi.fn(async (_chat: number, _topic: number, _text: string) => {})
  installQueueNoticeTransport(() => ({ db: env.db, authToken: 'test', botToken: 'test-bot', send }))
  await drainUserQueueHead(agentId)
  expect(mocks.run).not.toHaveBeenCalled()
  expect(queue.get(env.db, agentId, item.id)?.status).toBe('failed')
  expect(send).toHaveBeenCalledOnce()
  expect(send.mock.calls[0]?.slice(0, 2)).toEqual([-100, 42])
  expect(send.mock.calls[0]?.[2]).toContain(item.id)
  expect(send.mock.calls[0]?.[2].length).toBeLessThan(200)
  expect(JSON.stringify(send.mock.calls)).not.toContain(secret)
  expect(JSON.stringify(send.mock.calls)).not.toContain('Private instruction')
  expect(JSON.stringify(queue.get(env.db, agentId, item.id))).not.toContain(secret)
  expect(await drainUserQueueHead(agentId)).toBe(false)
  expect(send).toHaveBeenCalledOnce()
})
test('pause and FIFO checks preserve pending approval ownership', async () => {
  const first = await held()
  const second = await held()
  expect(() => assertQueuedApprovalReady(second.approval)).toThrow()
  queue.setPaused(env.db, agentId, true, 0)
  expect(() => assertQueuedApprovalReady(first.approval)).toThrow()
  expect(approvals.get(env.db, first.approval.id)?.status).toBe('pending')
  expect(mocks.prepare).not.toHaveBeenCalled()
})
test('waiting for an active Agent never overlaps and rechecks policy after admission', async () => {
  const { item, approval } = await held()
  const claimed = claim(approval)
  registerAgent(agentId, new AbortController())
  const delivery = deliverQueuedApproval(claimed)
  await Promise.resolve()
  expect(mocks.prepare).not.toHaveBeenCalled()
  env.db.raw.run("DELETE FROM team_policy_edges WHERE team_id = ? AND source_kind = 'user'", [
    env.teamId,
  ])
  unregisterAgent(agentId)
  await expect(delivery).rejects.toThrow('policy changed')
  expect(mocks.release).toHaveBeenCalledTimes(1)
  expect(mocks.run).not.toHaveBeenCalled()
  expect(queue.get(env.db, agentId, item.id)?.status).toBe('failed')
})
test('missing outcome is uncertain, pauses the queue and cannot replay', async () => {
  const { item, approval } = await held()
  mocks.run.mockImplementation(async function* () {})
  await expect(deliverQueuedApproval(claim(approval))).rejects.toThrow()
  expect(queue.get(env.db, agentId, item.id)?.status).toBe('uncertain')
  expect(queue.control(env.db, agentId).paused).toBe(true)
})
test('restart reconciles the gap after approval claim but before queue claim', async () => {
  const { item, approval } = await held()
  claim(approval)
  expect(queue.recoverInterrupted(env.db)).toBe(1)
  expect(queue.get(env.db, agentId, item.id)?.status).toBe('uncertain')
  expect(queue.control(env.db, agentId).paused).toBe(true)
  expect(queue.recoverInterrupted(env.db)).toBe(0)
  await expect(deliverQueuedApproval(approval)).rejects.toThrow()
  expect(mocks.run).not.toHaveBeenCalled()
})

test('restored canonical approval cannot release a previously pending hold', async () => {
  const { item, approval } = await held()
  const file = join(env.home, 'restored.db')
  env.db.raw.run('VACUUM INTO ?', [file])
  pauseRestoredUserQueue(file)
  const source = env.db
  const restored = openDb(file)
  env.db = restored
  try {
    expect(queue.get(restored, agentId, item.id)).toMatchObject({
      status: 'uncertain',
      approvalId: approval.id,
    })
    expect(approvals.get(restored, approval.id)?.status).toBe('pending')
    expect(() => assertQueuedApprovalReady(approval)).toThrow()
    expect(queue.readInput(restored, agentId, item.id).attachments).toHaveLength(1)
    expect(queue.get(source, agentId, item.id)?.status).toBe('held')
    expect(mocks.prepare).not.toHaveBeenCalled()
  } finally {
    env.db = source
    restored.close()
  }
})

test.each([
  'denied',
  'expired',
  'cancelled',
  'delivered',
  'delivery_failed',
])('terminal %s approval reconciles its hold without executing input', async (status) => {
  const { item, approval } = await held()
  env.db.raw.run('UPDATE communication_approvals SET status = ? WHERE id = ?', [
    status,
    approval.id,
  ])
  expect(queue.reconcileApprovalHolds(env.db)).toBe(1)
  const uncertain = status === 'delivered' || status === 'delivery_failed'
  expect(queue.get(env.db, agentId, item.id)?.status).toBe(uncertain ? 'uncertain' : 'cancelled')
  expect(queue.control(env.db, agentId).paused).toBe(uncertain)
  expect(queue.reconcileApprovalHolds(env.db)).toBe(0)
  expect(mocks.run).not.toHaveBeenCalled()
})
