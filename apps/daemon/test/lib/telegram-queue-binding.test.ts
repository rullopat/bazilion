import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import { setTelegramTopicId } from '../../src/core/repos/agents.ts'
import * as approvals from '../../src/core/repos/communicationApprovals.ts'
import { openSecrets } from '../../src/core/repos/secrets.ts'
import * as acl from '../../src/core/repos/telegram-acl.ts'
import * as pairing from '../../src/core/repos/telegram-pairing.ts'
import * as queue from '../../src/core/repos/user-queue.ts'
import type { TelegramIngressAttempt } from '../../src/lib/telegram/ingress-attempt.ts'
import {
  _resetOutboundQueueForTest,
  enqueueOutbound,
} from '../../src/lib/telegram/outbound-queue.ts'
import {
  captureTelegramQueueBinding,
  requireTelegramQueueBinding,
  requireTelegramQueuedTurn,
} from '../../src/lib/telegram/queue-binding.ts'
import {
  installQueueNoticeTransport,
  notifyTelegramQueueStatus,
} from '../../src/lib/telegram/queue-notice.ts'
import { enqueueTelegramInput } from '../../src/lib/user-queue-admission.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'
import { seedRegisteredConversation } from '../fixtures/conversation.ts'

let env: TestEnv
let attempt: TelegramIngressAttempt
vi.mock('../../src/lib/ctx.ts', () => ({
  getCtx: () => ({ db: env.db, paths: env.paths, authToken: 'test' }),
}))
beforeEach(() => {
  env = makeTestEnv()
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-credential-only')
  vi.stubEnv('TELEGRAM_CHAT_ID', '-100')
  vi.stubEnv('BAZILION_TEAM_POLICY_ENFORCEMENT', 'on')
  createProfile(env.db, env.paths, {
    id: 'binding',
    defaultModel: 'lmstudio:test',
    communicationDefaults: {
      userInput: true,
      userOutput: true,
      outsideTeamInput: false,
      outsideTeamOutput: false,
      peerDefault: 'allow_all',
    },
  })
  const agentId = spawnAgent(env.db, env.paths, { profileId: 'binding', teamId: env.teamId }).id
  setTelegramTopicId(env.db, agentId, 42)
  acl.add(env.db, { userId: 123, role: 'owner' })
  attempt = {
    origin: 'telegram_agent_topic',
    attemptKind: 'telegram_ingress',
    attemptId: '-100:5',
    requester: 'telegram:123',
    approvalPayloadKind: 'telegram_ingress',
    approvalPayload: {
      agentId,
      conversationId: seedRegisteredConversation(env.db, env.paths, agentId).id,
      text: 'retained',
      media: null,
      chatId: -100,
      threadId: 42,
      messageId: 5,
    },
  }
})
afterEach(() => {
  installQueueNoticeTransport(null)
  _resetOutboundQueueForTest()
  vi.unstubAllEnvs()
  vi.useRealTimers()
  env.cleanup()
})
test('capture retains authority identity without the bot credential', () => {
  const saved = captureTelegramQueueBinding(env.db, 'test', attempt)
  expect(requireTelegramQueueBinding(env.db, 'test', saved)).toEqual(saved)
  expect(JSON.stringify(saved)).not.toContain('test-credential-only')
  expect(() =>
    captureTelegramQueueBinding(env.db, 'test', { ...attempt, requester: 'telegram:456' }),
  ).toThrow()
})
test('rejects mismatched Telegram attempt identity and substituted queued input', async () => {
  const saved = captureTelegramQueueBinding(env.db, 'test', attempt)
  const turn = {
    agentId: attempt.approvalPayload.agentId,
    conversationId: attempt.approvalPayload.conversationId,
    message: 'retained',
    attachments: [],
  }
  expect(() =>
    requireTelegramQueuedTurn(env.db, 'test', saved, {
      ...turn,
      agentId: 'other-agent',
    }),
  ).toThrow()
  await expect(
    enqueueTelegramInput(
      {
        ...saved,
        authorization: { ...attempt, attemptId: '-100:6' },
      },
      'retained',
      [],
    ),
  ).rejects.toThrow()
  await expect(enqueueTelegramInput(saved, 'substituted', [])).rejects.toThrow()
  await expect(
    enqueueTelegramInput(saved, 'retained', [
      { name: 'extra.txt', mimeType: 'text/plain', data: 'eA==' },
    ]),
  ).rejects.toThrow()
  expect(queue.list(env.db, turn.agentId).total).toBe(0)
})
test('re-pairing the same owner at the same clock time invalidates old authority', () => {
  vi.useFakeTimers()
  vi.setSystemTime(123456789)
  pairing.reset(env.db)
  acl.add(env.db, { userId: 123, role: 'owner' })
  const saved = captureTelegramQueueBinding(env.db, 'test', attempt)
  pairing.reset(env.db)
  acl.add(env.db, { userId: 123, role: 'owner' })
  expect(() => requireTelegramQueueBinding(env.db, 'test', saved)).toThrow('binding changed')
})
test('reassigning the same topic invalidates old input; metadata edits keep owner identity', () => {
  const saved = captureTelegramQueueBinding(env.db, 'test', attempt)
  acl.add(env.db, { userId: 123, label: 'Renamed owner' })
  expect(requireTelegramQueueBinding(env.db, 'test', saved)).toEqual(saved)
  setTelegramTopicId(env.db, attempt.approvalPayload.agentId, 42)
  expect(() => requireTelegramQueueBinding(env.db, 'test', saved)).toThrow('binding changed')
})
test('credential rotation, missing credential and chat changes reject retained input', () => {
  const saved = captureTelegramQueueBinding(env.db, 'test', attempt)
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'replacement-credential')
  expect(() => requireTelegramQueueBinding(env.db, 'test', saved)).toThrow('binding changed')
  vi.stubEnv('TELEGRAM_BOT_TOKEN', '')
  expect(() => requireTelegramQueueBinding(env.db, 'test', saved)).toThrow('unavailable')
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-credential-only')
  vi.stubEnv('TELEGRAM_CHAT_ID', '-200')
  expect(() => requireTelegramQueueBinding(env.db, 'test', saved)).toThrow('unavailable')
})

test('removing and re-adding the same stored credential creates a new binding', () => {
  const secrets = openSecrets(env.db, 'test')
  secrets.set('TELEGRAM_BOT_TOKEN', 'test-credential-only')
  const saved = captureTelegramQueueBinding(env.db, 'test', attempt)
  secrets.remove('TELEGRAM_BOT_TOKEN')
  secrets.set('TELEGRAM_BOT_TOKEN', 'test-credential-only')
  expect(() => requireTelegramQueueBinding(env.db, 'test', saved)).toThrow('binding changed')
})

test('Telegram admission retains exact attempts once and captures reference-only approval holds', async () => {
  const binding = captureTelegramQueueBinding(env.db, 'test', attempt)
  const agentId = attempt.approvalPayload.agentId
  env.db.raw.run(
    "UPDATE team_policy_edges SET posture = 'approval_required' WHERE team_id = ? AND source_kind = 'user' AND target_id = ?",
    [env.teamId, agentId],
  )
  const accepted = await enqueueTelegramInput(binding, 'retained', [])
  expect(accepted.status).toBe('held')
  expect((await enqueueTelegramInput(binding, 'retained', [])).id).toBe(accepted.id)
  expect(queue.list(env.db, agentId).total).toBe(1)
  if (!accepted.approvalId) throw new Error('Missing canonical hold')
  const approval = approvals.get(env.db, accepted.approvalId, true)
  expect(approval).toMatchObject({
    payloadKind: 'queued_user',
    attemptId: '-100:5',
    payload: queue.approvalReference(env.db, agentId, accepted.id),
  })
  expect(JSON.stringify(approval)).not.toContain('retained')
})

test('missing media or binding changes during download cannot accept partial input', async () => {
  attempt.approvalPayload.media = {
    kind: 'document',
    fileId: 'file',
    fileName: 'original.txt',
    mimeType: 'text/plain',
    fileSize: 1,
  }
  const binding = captureTelegramQueueBinding(env.db, 'test', attempt)
  await expect(enqueueTelegramInput(binding, 'retained', [])).rejects.toThrow('incomplete')
  const attachments = [{ name: 'original.txt', mimeType: 'text/plain', data: 'eA==' }]
  await expect(
    enqueueTelegramInput(binding, 'retained', [{ ...attachments[0]!, data: 'eHg=' }]),
  ).rejects.toThrow('size differs')
  setTelegramTopicId(env.db, attempt.approvalPayload.agentId, 42)
  await expect(enqueueTelegramInput(binding, 'retained', attachments)).rejects.toThrow(
    'binding changed',
  )
  expect(queue.list(env.db, attempt.approvalPayload.agentId).total).toBe(0)
})

test('failure notice contains only receipt metadata and transport failure leaves outcome intact', async () => {
  const binding = captureTelegramQueueBinding(env.db, 'test', attempt)
  const item = await enqueueTelegramInput(binding, 'retained', [])
  queue.transition(env.db, item.agentId, item.id, 'pending', 'failed', {
    diagnostic: 'private provider diagnostic',
  })
  const send = vi.fn(async () => {
    throw new Error('https://api.telegram.org/bottest-credential-only/failure')
  })
  installQueueNoticeTransport(() => ({
    db: env.db,
    authToken: 'test',
    botToken: 'test-credential-only',
    send,
  }))
  await notifyTelegramQueueStatus(env.db, item.agentId, item.id)
  expect(send).toHaveBeenCalledOnce()
  expect(send.mock.calls[0]?.slice(0, 2)).toEqual([-100, 42])
  expect(JSON.stringify(send.mock.calls)).not.toContain('retained')
  expect(JSON.stringify(send.mock.calls)).not.toContain('private provider diagnostic')
  expect(queue.get(env.db, item.agentId, item.id)?.status).toBe('failed')
})

test('binding is rechecked after waiting for outbound pacing', async () => {
  const binding = captureTelegramQueueBinding(env.db, 'test', attempt)
  const item = await enqueueTelegramInput(binding, 'retained', [])
  queue.transition(env.db, item.agentId, item.id, 'pending', 'failed')
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const prior = enqueueOutbound(-100, () => gate, { minIntervalMs: 0 })
  const send = vi.fn(async () => {})
  installQueueNoticeTransport(() => ({
    db: env.db,
    authToken: 'test',
    botToken: 'test-credential-only',
    send,
  }))
  const notice = notifyTelegramQueueStatus(env.db, item.agentId, item.id)
  setTelegramTopicId(env.db, item.agentId, 42)
  release()
  await prior
  await notice
  expect(send).not.toHaveBeenCalled()
})
