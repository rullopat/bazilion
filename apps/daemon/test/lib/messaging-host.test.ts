import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createProfile, spawnAgent } from '../../src/core/index.ts'
import { createDbMessagingHost } from '../../src/lib/messaging-host.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
let owner: string
let peer: string
beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, {
    id: 'coder',
    defaultModel: 'lmstudio:test',
  })
  owner = spawnAgent(env.db, env.paths, { profileId: 'coder', teamId: env.teamId }).id
  peer = spawnAgent(env.db, env.paths, { profileId: 'coder', teamId: env.teamId }).id
})
afterEach(() => {
  vi.unstubAllEnvs()
  env.cleanup()
})

test('a teammate reply reaches the sender waiting for it in the same Team', async () => {
  const messages = createDbMessagingHost(env.db)
  const sent = await messages.sendMessage({
    from: owner,
    to: peer,
    replyTo: null,
    payload: 'Run the tests and tell me the result',
  })
  expect(await messages.findReplies(owner, sent.messageId)).toEqual([])
  await messages.sendMessage({ from: peer, to: owner, payload: 'done', replyTo: sent.messageId })
  expect(await messages.findReplies(owner, sent.messageId)).toHaveLength(1)
})

test('a teammate addressed by an id prefix gets the message', async () => {
  const messages = createDbMessagingHost(env.db)
  await messages.sendMessage({ from: owner, to: peer.slice(0, 8), replyTo: null, payload: 'hi' })
  expect(await messages.listInbox(peer, { unreadOnly: false })).toHaveLength(1)
})
