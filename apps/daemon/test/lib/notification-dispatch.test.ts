import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { acknowledgeAttention } from '../../src/core/attention.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as receipts from '../../src/core/repos/notifications.ts'
import { NotificationDispatcher } from '../../src/lib/notification-dispatch.ts'
import {
  _resetOutboundQueueForTest,
  enqueueOutbound,
} from '../../src/lib/telegram/outbound-queue.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
let agentId: string
let now = 100
const binding: receipts.NotificationBinding = {
  id: 'destination',
  chatId: -100,
  topicId: 7,
  ownerGrantId: 'owner',
  botDigest: 'digest',
}
const send = vi.fn()
const verify = vi.fn()
let dispatcher: NotificationDispatcher
beforeEach(() => {
  env = makeTestEnv()
  now = 100
  vi.stubEnv('BAZILION_TEAM_POLICY_ENFORCEMENT', 'off')
  createProfile(env.db, env.paths, { id: 'notices', defaultModel: 'lmstudio:test' })
  agentId = spawnAgent(env.db, env.paths, { profileId: 'notices', teamId: env.teamId }).id
  env.db.raw.run(
    `INSERT INTO agent_reviews (id,agent_id,status,trigger_kind,next_attempt_at,last_error,created_at,updated_at)
    VALUES ('review',?,'failed','manual',1,'PRIVATE_ERROR',10,20)`,
    [agentId],
  )
  const initial = receipts.settings(env.db)
  receipts.saveSettings(env.db, 0, { ...initial, enabled: true, eligibleAfter: 1 }, binding, 1)
  send.mockReset().mockResolvedValue({ message_id: 99 })
  verify.mockReset().mockResolvedValue(true)
  dispatcher = new NotificationDispatcher(
    env.db,
    { capture: () => binding, verify, send },
    () => now,
  )
})
afterEach(() => {
  _resetOutboundQueueForTest()
  vi.unstubAllEnvs()
  env.cleanup()
})
test('normal delivery is deduplicated across ticks and restart without acknowledging the source', async () => {
  await dispatcher.tick()
  await dispatcher.tick()
  receipts.recoverInterrupted(env.db)
  await dispatcher.tick()
  expect(send).toHaveBeenCalledOnce()
  expect(receipts.list(env.db).receipts[0]?.state).toBe('delivered')
  expect(String(send.mock.calls[0]?.[1])).not.toContain('PRIVATE_ERROR')
  expect(
    env.db.raw.query<{ n: number }, []>('SELECT COUNT(*) n FROM attention_acknowledgements').get()
      ?.n,
  ).toBe(0)
})
test('resolution during quiet hours suppresses the deferred source', async () => {
  const current = receipts.settings(env.db)
  receipts.saveSettings(
    env.db,
    current.revision,
    { ...current, quietHours: { start: '00:00', end: '01:00' } },
    binding,
  )
  await dispatcher.tick()
  expect(receipts.list(env.db).receipts[0]?.state).toBe('deferred')
  acknowledgeAttention(env.db, 'review_failure:review', true)
  now = 7_200_000
  await dispatcher.tick()
  expect(send).not.toHaveBeenCalled()
  expect(receipts.list(env.db).receipts[0]?.diagnostic).toBe('source_resolved')
})
test('disablement during remote validation prevents the actual send', async () => {
  verify.mockImplementationOnce(async () => {
    const current = receipts.settings(env.db)
    receipts.saveSettings(env.db, current.revision, { ...current, enabled: false }, binding)
    return true
  })
  await dispatcher.tick()
  expect(send).not.toHaveBeenCalled()
  expect(receipts.list(env.db).receipts[0]?.state).toBe('suppressed')
})
test('ambiguous transport errors remain uncertain and are not automatically retried', async () => {
  send.mockRejectedValueOnce(new Error('socket timeout with too many requests text'))
  await dispatcher.tick()
  await dispatcher.tick()
  expect(send).toHaveBeenCalledOnce()
  expect(receipts.list(env.db).receipts[0]?.state).toBe('uncertain')
})
test('known 429 receives one paced retry and then a confirmed receipt', async () => {
  send.mockRejectedValueOnce({ error_code: 429, parameters: { retry_after: 0 } })
  await dispatcher.tick()
  expect(send).toHaveBeenCalledTimes(2)
  expect(verify).toHaveBeenCalledTimes(2)
  expect(receipts.list(env.db).receipts[0]).toMatchObject({ state: 'delivered', attempts: 2 })
})
test('shutdown during destination validation prevents any subsequent send', async () => {
  verify.mockImplementationOnce(async () => {
    dispatcher.stop()
    return true
  })
  await dispatcher.tick()
  await dispatcher.tick()
  expect(send).not.toHaveBeenCalled()
  expect(receipts.list(env.db).receipts[0]?.state).toBe('deferred')
})
test('shutdown after a possible send leaves restart uncertainty instead of claiming success', async () => {
  send.mockImplementationOnce(async () => {
    dispatcher.stop()
    return { message_id: 100 }
  })
  await dispatcher.tick()
  expect(receipts.list(env.db).receipts[0]?.state).toBe('sending')
  receipts.recoverInterrupted(env.db)
  expect(receipts.list(env.db).receipts[0]?.state).toBe('uncertain')
})
test('a paced 429 retry does not mutate the database after shutdown', async () => {
  let writes: ReturnType<typeof vi.spyOn> | undefined
  send.mockImplementationOnce(async () => {
    dispatcher.stop()
    writes = vi.spyOn(env.db.raw, 'run')
    throw { error_code: 429, parameters: { retry_after: 0 } }
  })
  try {
    await dispatcher.tick()
    expect(send).toHaveBeenCalledOnce()
    expect(writes).not.toHaveBeenCalled()
  } finally {
    writes?.mockRestore()
  }
})
test('unbounded rate-limit delays and other 4xx descriptions do not trigger automatic retries', async () => {
  send.mockRejectedValueOnce({ error_code: 429, parameters: { retry_after: 3600 } })
  await dispatcher.tick()
  expect(send).toHaveBeenCalledOnce()
  const first = receipts.list(env.db).receipts[0]
  if (!first) throw new Error('Missing fixture receipt')
  expect(first.state).toBe('failed')
  receipts.retry(env.db, first.id, first.updatedAt, true)
  send.mockRejectedValueOnce({ error_code: 400, message: 'Too Many Requests' })
  await dispatcher.tick()
  expect(send).toHaveBeenCalledTimes(2)
  expect(receipts.get(env.db, first.id)?.state).toBe('failed')
})
test.each([
  'source_resolved',
  'policy_suppressed',
  'destination_changed',
] as const)('%s while waiting for outbound pacing prevents the send', async (reason) => {
  let release: () => void = () => {}
  const blocker = enqueueOutbound(
    binding.chatId,
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      }),
    { minIntervalMs: 0 },
  )
  await Promise.resolve()
  const pending = dispatcher.tick()
  await Promise.resolve()
  if (reason === 'source_resolved') acknowledgeAttention(env.db, 'review_failure:review', true)
  if (reason === 'policy_suppressed') vi.stubEnv('BAZILION_TEAM_POLICY_ENFORCEMENT', 'on')
  if (reason === 'destination_changed')
    vi.spyOn(dispatcher.transport, 'capture').mockReturnValue({ ...binding, id: 'changed' })
  release()
  await blocker
  await pending
  expect(send).not.toHaveBeenCalled()
  expect(receipts.list(env.db).receipts[0]).toMatchObject({
    state: 'suppressed',
    diagnostic: reason,
  })
})
