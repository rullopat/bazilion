import type { ChatFrame } from '@bazilion/api-types'
import type { Api, InputFile } from 'grammy'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { resolveAgent } from '../../src/core/agent/resolve.ts'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as agentRepo from '../../src/core/repos/agents.ts'
import * as results from '../../src/core/repos/results.ts'
import { resolveConversationTarget } from '../../src/lib/conversation-target.ts'
import { createResultHost } from '../../src/lib/result-host.ts'
import { setTelegramLive } from '../../src/lib/telegram/live.ts'
import { _resetMirrorForTest, mirrorAgentTurnFrame } from '../../src/lib/telegram/mirror.ts'
import { _resetOutboundQueueForTest } from '../../src/lib/telegram/outbound-queue.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
let agentId: string
let conversationId: string
vi.mock('../../src/lib/ctx.ts', () => ({
  getCtx: () => ({ db: env.db, paths: env.paths, authToken: 'test-only' }),
}))
beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, { id: 'producer', defaultModel: 'lmstudio:test' })
  agentId = spawnAgent(env.db, env.paths, { profileId: 'producer', teamId: env.teamId }).id
  conversationId = resolveConversationTarget(env.db, env.paths, agentId).id
})
afterEach(() => {
  env.cleanup()
})
function host(signal = new AbortController().signal) {
  return createResultHost(env.db, resolveAgent(env.db, env.paths, agentId), conversationId, signal)
}
const file = {
  toolCallId: 'call',
  name: 'report.txt',
  mimeType: 'text/plain',
  data: Buffer.from('captured').toString('base64'),
}

test('a delivered file is saved for the turn’s Agent, Team and conversation, once per tool call', async () => {
  const result = await host().publish(file)
  expect(results.get(env.db, result.resultId)).toMatchObject({
    agentId,
    teamId: env.teamId,
    sessionId: conversationId,
    toolCallId: 'call',
    name: 'report.txt',
  })
  expect(results.read(env.db, result.resultId).toString()).toBe('captured')
  expect(await host().publish(file)).toEqual(result)
  await expect(host().publish({ ...file, toolCallId: 'bad id' })).rejects.toThrow('tool call')
  await expect(
    host(AbortSignal.abort()).publish({ ...file, toolCallId: 'other' }),
  ).rejects.toThrow()
  expect(results.list(env.db).total).toBe(1)
})

test('Telegram sends the saved bytes and keeps the result after a failed document send', async () => {
  const result = await host().publish(file)
  const event: ChatFrame = {
    kind: 'event',
    event: { type: 'file', result, name: file.name, mimeType: file.mimeType },
  }
  agentRepo.setTelegramTopicId(env.db, agentId, 42)
  let captured = ''
  const api = {
    sendMessage: vi.fn(),
    sendChatAction: vi.fn(),
    sendPhoto: vi.fn(),
    async sendDocument(_chat: number, input: InputFile) {
      const raw = await input.toRaw()
      if (!(raw instanceof Uint8Array)) throw new Error('Expected captured buffer')
      captured = Buffer.from(raw).toString()
      throw new Error('transport unavailable')
    },
  }
  setTelegramLive({ api: api as unknown as Api, chatId: -100123, db: env.db, paths: env.paths })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    await mirrorAgentTurnFrame(agentId, event)
    expect(captured).toBe('captured')
    expect(results.list(env.db).total).toBe(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('telegram_mirror_file_failed'))
  } finally {
    warn.mockRestore()
    setTelegramLive(null)
    _resetMirrorForTest()
    _resetOutboundQueueForTest()
  }
})
