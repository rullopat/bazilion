import type { Api } from 'grammy'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createProfile, spawnAgent } from '../../src/core/index.ts'
import * as queue from '../../src/core/repos/user-queue.ts'
import { setTelegramLive } from '../../src/lib/telegram/live.ts'
import { _resetOutboundQueueForTest } from '../../src/lib/telegram/outbound-queue.ts'
import { notifyTelegramQueueOutcome } from '../../src/lib/telegram/queue-notice.ts'
import { enqueueUserInput } from '../../src/lib/user-queue.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'
import { seedRegisteredConversation } from '../fixtures/conversation.ts'

let env: TestEnv
let agentId: string
let messageId = 0
const sendMessage = vi.fn()

beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, { id: 'notice', defaultModel: 'lmstudio:test' })
  agentId = spawnAgent(env.db, env.paths, { profileId: 'notice', teamId: env.teamId }).id
  seedRegisteredConversation(env.db, env.paths, agentId)
  sendMessage.mockReset().mockResolvedValue({ message_id: 1 })
  setTelegramLive({
    api: { sendMessage } as unknown as Api,
    chatId: -100,
    db: env.db,
    paths: env.paths,
  })
})
afterEach(() => {
  setTelegramLive(null)
  _resetOutboundQueueForTest()
  env.cleanup()
})

async function failed() {
  const item = await enqueueUserInput(
    agentId,
    {
      message: 'retained',
      attachments: [],
      telegram: { chatId: -100, threadId: 42, messageId: ++messageId, userId: 11 },
    },
    env,
  )
  const claimed = queue.claim(env.db, agentId)
  const finished = queue.finish(env.db, agentId, item.id, 'failed', 'private provider diagnostic')
  if (!finished || !claimed) throw new Error('fixture item did not run')
  return { item: finished, origin: claimed.origin }
}

test('the reply names the outcome in the message’s topic, without its text or diagnostic', async () => {
  const { item, origin } = await failed()
  await notifyTelegramQueueOutcome(item, origin, 'failed')
  expect(sendMessage).toHaveBeenCalledOnce()
  expect(sendMessage.mock.calls[0]?.[0]).toBe(-100)
  expect(sendMessage.mock.calls[0]?.[1]).toBe('This message failed.')
  expect(sendMessage.mock.calls[0]?.[2]).toMatchObject({
    message_thread_id: 42,
    reply_parameters: { message_id: messageId },
  })
  expect(JSON.stringify(sendMessage.mock.calls)).not.toContain('retained')
  expect(JSON.stringify(sendMessage.mock.calls)).not.toContain('private provider diagnostic')
})

test('a failed notice changes nothing, and a stopped bot or a migrated chat gets nothing', async () => {
  const { item, origin } = await failed()
  sendMessage.mockRejectedValueOnce(new Error('https://api.telegram.org/bot1:secret/failure'))
  await expect(notifyTelegramQueueOutcome(item, origin, 'failed')).resolves.toBeUndefined()
  expect(queue.get(env.db, agentId, item.id)?.status).toBe('failed')

  setTelegramLive(null)
  await notifyTelegramQueueOutcome(item, origin, 'failed')
  expect(sendMessage).toHaveBeenCalledOnce()

  setTelegramLive({
    api: { sendMessage } as unknown as Api,
    chatId: -200,
    db: env.db,
    paths: env.paths,
  })
  await notifyTelegramQueueOutcome(item, origin, 'failed')
  expect(sendMessage).toHaveBeenCalledOnce()
})
