import type { Api } from 'grammy'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as agentRepo from '../../src/core/repos/agents.ts'
import * as acl from '../../src/core/repos/telegram-acl.ts'
import * as pairing from '../../src/core/repos/telegram-pairing.ts'
import * as queue from '../../src/core/repos/user-queue.ts'
import {
  AgentTurnActiveError,
  isActiveAgent,
  registerAgent,
  unregisterAgent,
} from '../../src/lib/agent-cancel.ts'
import { startConversation } from '../../src/lib/conversation-target.ts'
import { setTelegramLive } from '../../src/lib/telegram/live.ts'
import { _resetOutboundQueueForTest } from '../../src/lib/telegram/outbound-queue.ts'
import {
  drainUserQueueHead,
  enqueueUserInput,
  startUserQueuePump,
  stopAgentTurn,
} from '../../src/lib/user-queue.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
let agentId: string
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), run: vi.fn() }))
vi.mock('../../src/lib/ctx.ts', () => ({
  getCtx: () => ({ db: env.db, paths: env.paths, authToken: 'test' }),
}))
vi.mock('../../src/lib/agent-turn.ts', () => ({
  prepareAgentTurn: mocks.prepare,
  runAgentTurn: mocks.run,
}))
beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, { id: 'queue', defaultModel: 'lmstudio:test' })
  agentId = spawnAgent(env.db, env.paths, { profileId: 'queue', teamId: env.teamId }).id
  mocks.prepare.mockReset().mockImplementation(async () => ({ controller: new AbortController() }))
  mocks.run.mockReset().mockImplementation(async function* () {
    yield { kind: 'done', messages: [] }
  })
})
afterEach(() => {
  setTelegramLive(null)
  _resetOutboundQueueForTest()
  vi.useRealTimers()
  unregisterAgent(agentId)
  env.cleanup()
})
const add = (message: string, id = agentId) => enqueueUserInput(id, { message, attachments: [] })

test('input queued while the Agent is busy keeps the running turn and its conversation', async () => {
  const controller = new AbortController()
  registerAgent(agentId, controller)
  const item = await add('Keep this follow-up')
  expect(item).toMatchObject({ status: 'pending', source: 'http' })
  expect(controller.signal.aborted).toBe(false)
  // A new conversation is not blocked by waiting items, which keep the one they were sent to.
  const next = startConversation(env.db, env.paths, agentId)
  expect(next.id).not.toBe(item.conversationId)
  unregisterAgent(agentId)
  expect(await drainUserQueueHead(agentId)).toBe(true)
  expect(mocks.prepare.mock.calls[0]?.[0].conversationId).toBe(item.conversationId)
  agentRepo.archive(env.db, agentId)
  await expect(add('too late')).rejects.toThrow(queue.QueueConflictError)
})

test('Stop pressed before the worker starts records the item as cancelled, not failed', async () => {
  const item = await add('stopped early')
  const controller = new AbortController()
  mocks.prepare.mockImplementationOnce(async () => ({ controller }))
  mocks.run.mockImplementationOnce(async function* () {
    controller.abort()
    controller.signal.throwIfAborted()
    yield { kind: 'done', messages: [] }
  })
  expect(await drainUserQueueHead(agentId)).toBe(true)
  expect(queue.get(env.db, agentId, item.id)).toMatchObject({ status: 'cancelled' })
})

test('a follow-up refused because the daemon is stopping stays waiting', async () => {
  const item = await add('after restart')
  mocks.prepare.mockRejectedValueOnce(new Error('daemon_shutting_down'))
  expect(await drainUserQueueHead(agentId)).toBe(false)
  expect(queue.get(env.db, agentId, item.id)?.status).toBe('pending')
})

test('items run one at a time, oldest first, once the Agent is free', async () => {
  const first = await add('first')
  const second = await add('second')
  registerAgent(agentId, new AbortController())
  expect(await drainUserQueueHead(agentId)).toBe(false)
  unregisterAgent(agentId)
  expect(await drainUserQueueHead(agentId)).toBe(true)
  expect(queue.get(env.db, agentId, first.id)?.status).toBe('completed')
  expect(queue.get(env.db, agentId, second.id)?.status).toBe('pending')
  // Nobody watches a follow-up: it cannot ask and it auto-denies dangerous commands.
  expect(mocks.prepare.mock.calls[0]?.[0]).toMatchObject({
    origin: 'http',
    message: 'first',
    bashApprovalMode: 'auto_deny',
  })
  expect(mocks.prepare.mock.calls[0]?.[0].questionMode).toBeUndefined()
  expect(await drainUserQueueHead(agentId)).toBe(true)
  expect(await drainUserQueueHead(agentId)).toBe(false)
  expect(mocks.run).toHaveBeenCalledTimes(2)
})

test('a turn that started first keeps the item waiting; other failures fail only that item', async () => {
  const failed = await add('fails before execution')
  const next = await add('later input')
  mocks.prepare.mockRejectedValueOnce(new AgentTurnActiveError(agentId))
  expect(await drainUserQueueHead(agentId)).toBe(false)
  expect(queue.get(env.db, agentId, failed.id)?.status).toBe('pending')
  mocks.prepare.mockRejectedValueOnce(new Error(`message mentions agent_turn_active: ${agentId}`))
  await drainUserQueueHead(agentId)
  // The item keeps the real reason.
  expect(queue.get(env.db, agentId, failed.id)).toMatchObject({
    status: 'failed',
    diagnostic: `message mentions agent_turn_active: ${agentId}`,
  })
  await drainUserQueueHead(agentId)
  expect(queue.get(env.db, agentId, next.id)?.status).toBe('completed')
})

test('a stopped turn is cancelled; a turn without a reply fails; neither runs again', async () => {
  const stopped = await add('stopped')
  mocks.run.mockImplementationOnce(async function* () {
    yield { kind: 'event', event: { type: 'error', error: 'cancelled' } }
    yield { kind: 'done', messages: [] }
  })
  await drainUserQueueHead(agentId)
  expect(queue.get(env.db, agentId, stopped.id)?.status).toBe('cancelled')
  const silent = await add('no outcome')
  mocks.run.mockImplementationOnce(async function* () {})
  await drainUserQueueHead(agentId)
  expect(queue.get(env.db, agentId, silent.id)?.status).toBe('failed')
  expect(await drainUserQueueHead(agentId)).toBe(false)
  expect(mocks.run).toHaveBeenCalledTimes(2)
})

test('Stop pauses the queue only when follow-ups are waiting', async () => {
  registerAgent(agentId, new AbortController())
  expect(stopAgentTurn(env.db, agentId)).toEqual({ cancelled: true, queuePaused: false })
  expect(queue.isPaused(env.db, agentId)).toBe(false)
  unregisterAgent(agentId)
  registerAgent(agentId, new AbortController())
  await add('waiting')
  expect(stopAgentTurn(env.db, agentId)).toEqual({ cancelled: true, queuePaused: true })
  expect(queue.isPaused(env.db, agentId)).toBe(true)
  unregisterAgent(agentId)
  expect(await drainUserQueueHead(agentId)).toBe(false)
})

test('Stop cancels a running follow-up and pauses the ones still waiting', async () => {
  const running = await add('running')
  const waiting = await add('waiting')
  const controller = new AbortController()
  mocks.prepare.mockImplementationOnce(async () => {
    registerAgent(agentId, controller)
    return {}
  })
  mocks.run.mockImplementationOnce(async function* () {
    await new Promise((resolve) => controller.signal.addEventListener('abort', resolve))
    unregisterAgent(agentId)
    yield { kind: 'event', event: { type: 'error', error: 'cancelled' } }
  })
  const drained = drainUserQueueHead(agentId)
  await vi.waitFor(() => expect(isActiveAgent(agentId)).toBe(true))
  expect(stopAgentTurn(env.db, agentId)).toEqual({ cancelled: true, queuePaused: true })
  expect(await drained).toBe(true)
  expect(queue.get(env.db, agentId, running.id)?.status).toBe('cancelled')
  expect(queue.get(env.db, agentId, waiting.id)?.status).toBe('pending')
  expect(await drainUserQueueHead(agentId)).toBe(false)
})

test('the pump drains one item at a time and claims nothing after it stops', async () => {
  vi.useFakeTimers()
  await add('first')
  const second = await add('second')
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

const origin = { chatId: -100, threadId: 42, messageId: 5, userId: 11 }
const fromTelegram = (message: string, from = origin) =>
  enqueueUserInput(agentId, { message, attachments: [], telegram: from })

test('a Telegram message is queued once and runs as a Telegram turn', async () => {
  acl.add(env.db, { userId: 11, role: 'owner' })
  const item = await fromTelegram('Telegram retained')
  expect((await fromTelegram('Telegram retained')).id).toBe(item.id)
  await drainUserQueueHead(agentId)
  expect(mocks.prepare.mock.calls[0]?.[0]).toMatchObject({
    origin: 'telegram',
    agentId,
    conversationId: item.conversationId,
    message: 'Telegram retained',
  })
  expect(queue.get(env.db, agentId, item.id)?.status).toBe('completed')
})

test('a queued Telegram message is cancelled once its sender loses access', async () => {
  acl.add(env.db, { userId: 11, role: 'owner' })
  acl.add(env.db, { userId: 12 })
  const fromMember = await fromTelegram('from member', { ...origin, messageId: 6, userId: 12 })
  const fromOwner = await fromTelegram('owner', { ...origin, messageId: 7 })
  const afterReset = await fromTelegram('later', { ...origin, messageId: 8 })
  acl.remove(env.db, 12)
  expect(await drainUserQueueHead(agentId)).toBe(true)
  expect(queue.get(env.db, agentId, fromMember.id)).toMatchObject({
    status: 'cancelled',
    diagnostic: 'The sender is no longer allowed',
  })
  expect(mocks.prepare).not.toHaveBeenCalled()
  await drainUserQueueHead(agentId)
  expect(queue.get(env.db, agentId, fromOwner.id)?.status).toBe('completed')
  // Resetting the pairing drops the owner's queued input too.
  pairing.reset(env.db)
  await drainUserQueueHead(agentId)
  expect(queue.get(env.db, agentId, afterReset.id)?.status).toBe('cancelled')
  expect(mocks.run).toHaveBeenCalledOnce()
})

test('a failed Telegram message gets one short reply in its topic; the queue keeps the reason', async () => {
  acl.add(env.db, { userId: 11, role: 'owner' })
  const item = await fromTelegram('Private instruction')
  const secret = 'TELEGRAM_PREFLIGHT_SECRET_SENTINEL'
  mocks.prepare.mockRejectedValueOnce(new Error(`Docker unavailable: ${secret}`))
  const sendMessage = vi.fn(
    async (_chat: number, _text: string, _opts: Record<string, unknown>) => ({ message_id: 1 }),
  )
  setTelegramLive({
    api: { sendMessage } as unknown as Api,
    chatId: -100,
    db: env.db,
    paths: env.paths,
  })
  await drainUserQueueHead(agentId)
  expect(mocks.run).not.toHaveBeenCalled()
  expect(queue.get(env.db, agentId, item.id)?.status).toBe('failed')
  expect(sendMessage).toHaveBeenCalledOnce()
  const [chatId, text, opts] = sendMessage.mock.calls[0] ?? []
  expect(chatId).toBe(-100)
  expect(opts).toMatchObject({ message_thread_id: 42, reply_parameters: { message_id: 5 } })
  // The topic gets a fixed line, never the failure itself; the owner reads that in the queue.
  expect(text).toBe('This message failed.')
  expect(queue.get(env.db, agentId, item.id)?.diagnostic).toBe(`Docker unavailable: ${secret}`)
  expect(await drainUserQueueHead(agentId)).toBe(false)
  expect(sendMessage).toHaveBeenCalledOnce()
})
