import type { Api } from 'grammy'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { acknowledgeAttention } from '../../src/core/attention.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import { openConfig } from '../../src/core/repos/config.ts'
import * as settings from '../../src/core/repos/notifications.ts'
import { sendAttentionNotifications } from '../../src/lib/notifications.ts'
import { setTelegramLive } from '../../src/lib/telegram/live.ts'
import { _resetOutboundQueueForTest } from '../../src/lib/telegram/outbound-queue.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
let agentId: string
const sendMessage = vi.fn()
const all = [
  'lesson_proposal',
  'review_failure',
  'trigger_failure',
  'agent_loop_break',
  'queue_interrupted',
] as const

function failReview(id: string, updatedAt: number): void {
  env.db.raw.run(
    `INSERT INTO agent_reviews (id,agent_id,status,trigger_kind,last_error,created_at,updated_at)
    VALUES (?,?,'failed','manual','PRIVATE_ERROR',?,?)`,
    [id, agentId, updatedAt, updatedAt],
  )
}

beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, { id: 'notices', defaultModel: 'lmstudio:test' })
  agentId = spawnAgent(env.db, env.paths, { profileId: 'notices', teamId: env.teamId }).id
  openConfig(env.db).set('TELEGRAM_SERVICE_TOPIC_ID', '7')
  sendMessage.mockReset().mockResolvedValue({ message_id: 99 })
  setTelegramLive({
    api: { sendMessage } as unknown as Api,
    chatId: -100,
    db: env.db,
    paths: env.paths,
  })
  settings.save(
    env.db,
    { enabled: true, kinds: [...all], timezone: 'UTC', quietHours: null },
    1_000,
  )
})
afterEach(() => {
  setTelegramLive(null)
  _resetOutboundQueueForTest()
  env.cleanup()
})

test('each new open item goes to the service topic once', async () => {
  failReview('review', 2_000)
  await sendAttentionNotifications(env.db, 3_000)
  await sendAttentionNotifications(env.db, 4_000)
  expect(sendMessage).toHaveBeenCalledOnce()
  const [chatId, text, opts] = sendMessage.mock.calls[0] ?? []
  expect(chatId).toBe(-100)
  expect(opts).toMatchObject({ message_thread_id: 7, parse_mode: 'HTML' })
  expect(text).toContain('Agent review failed')
  expect(text).not.toContain('PRIVATE_ERROR')
  // Sending never resolves the item.
  expect(
    env.db.raw.query<{ n: number }, []>('SELECT COUNT(*) n FROM attention_acknowledgements').get()
      ?.n,
  ).toBe(0)
})

test('items from before switching on, unselected kinds and resolved items are not sent', async () => {
  failReview('old', 500)
  failReview('acknowledged', 2_000)
  acknowledgeAttention(env.db, 'review_failure:acknowledged', true)
  settings.save(env.db, {
    enabled: true,
    kinds: ['trigger_failure'],
    timezone: 'UTC',
    quietHours: null,
  })
  failReview('unselected', 2_000)
  await sendAttentionNotifications(env.db, 3_000)
  expect(sendMessage).not.toHaveBeenCalled()
})

test('quiet hours and a failed send defer the notice to a later tick', async () => {
  settings.save(env.db, {
    enabled: true,
    kinds: [...all],
    timezone: 'UTC',
    quietHours: { start: '00:00', end: '06:00' },
  })
  failReview('review', 2_000)
  const night = Date.UTC(2026, 0, 1, 2, 0)
  await sendAttentionNotifications(env.db, night)
  expect(sendMessage).not.toHaveBeenCalled()
  sendMessage.mockRejectedValueOnce(new Error('network down'))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  await sendAttentionNotifications(env.db, night + 6 * 3_600_000)
  await sendAttentionNotifications(env.db, night + 7 * 3_600_000)
  expect(sendMessage).toHaveBeenCalledTimes(2)
  await sendAttentionNotifications(env.db, night + 8 * 3_600_000)
  expect(sendMessage).toHaveBeenCalledTimes(2)
})

test('an item that closes and opens again is sent again; nothing goes out while off or stopped', async () => {
  failReview('review', 2_000)
  await sendAttentionNotifications(env.db, 3_000)
  acknowledgeAttention(env.db, 'review_failure:review', true)
  await sendAttentionNotifications(env.db, 4_000)
  acknowledgeAttention(env.db, 'review_failure:review', false)
  await sendAttentionNotifications(env.db, 5_000)
  expect(sendMessage).toHaveBeenCalledTimes(2)

  failReview('later', 6_000)
  setTelegramLive(null)
  await sendAttentionNotifications(env.db, 7_000)
  settings.save(env.db, { enabled: false, kinds: [...all], timezone: 'UTC', quietHours: null })
  await sendAttentionNotifications(env.db, 8_000)
  expect(sendMessage).toHaveBeenCalledTimes(2)
})
