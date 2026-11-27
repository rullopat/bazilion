// Unit tests for the messaging `ToolHandler`s that Bazilion exposes as pi
// customTools. Called directly here (not through the LLM loop) because the
// tests are about tool *behaviour* — DB side effects, polling, error paths —
// not about round-tripping through pi's agent loop.

import type { ResolvedAgent } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { createProfile, messageRepo, resolveAgent, spawnAgent } from '../../src/core/index.ts'
import { createDbMessagingHost } from '../../src/lib/messaging-host.ts'
import { messagingTools } from '../../src/runtime/tools/messaging.ts'
import type { ToolHandler } from '../../src/runtime/tools/types.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

function makeAgent(env: TestEnv, name: string): ResolvedAgent {
  const a = spawnAgent(env.db, env.paths, {
    profileId: 'p',
    name,
    teamId: env.teamId,
  })
  return resolveAgent(env.db, env.paths, a.id)
}

function findHandler(handlers: ToolHandler[], name: string): ToolHandler {
  const h = handlers.find((x) => x.def.name === name)
  if (!h) throw new Error(`no handler: ${name}`)
  return h
}

let env: TestEnv
beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, {
    id: 'p',
    defaultModel: 'mock:m',
  })
})
afterEach(() => env.cleanup())

test('send_message tool inserts a row addressed to the recipient', async () => {
  const a = makeAgent(env, 'A')
  const b = makeAgent(env, 'B')
  const handlers = messagingTools(createDbMessagingHost(env.db), a.agent.id)
  const send = findHandler(handlers, 'send_message')

  await send.invoke({ to: b.agent.id, text: 'hi B, this is A' })

  const inbox = messageRepo.listInbox(env.db, b.agent.id)
  expect(inbox).toHaveLength(1)
  expect(inbox[0]?.fromAgentId).toBe(a.agent.id)
  const payload = JSON.parse(inbox[0]?.payload ?? '{}')
  expect(payload.text).toBe('hi B, this is A')
})

test('read_inbox returns unread messages and marks them read', async () => {
  const a = makeAgent(env, 'A')
  const b = makeAgent(env, 'B')

  messageRepo.send(env.db, {
    from: a.agent.id,
    to: b.agent.id,
    payload: JSON.stringify({ text: 'first' }),
  })
  messageRepo.send(env.db, {
    from: a.agent.id,
    to: b.agent.id,
    payload: JSON.stringify({ text: 'second' }),
  })

  const handlers = messagingTools(createDbMessagingHost(env.db), b.agent.id)
  const read = findHandler(handlers, 'read_inbox')
  const result = await read.invoke({})
  expect(result).toContain('first')
  expect(result).toContain('second')

  // After read, inbox shows nothing (unreadOnly default)
  const after = messageRepo.listInbox(env.db, b.agent.id, { unreadOnly: true })
  expect(after).toHaveLength(0)
})

test('send_message + read_inbox round-trip preserves reply_to pointer', async () => {
  const a = makeAgent(env, 'A')
  const b = makeAgent(env, 'B')

  // A sends B a question
  const aHandlers = messagingTools(createDbMessagingHost(env.db), a.agent.id)
  const aSend = findHandler(aHandlers, 'send_message')
  await aSend.invoke({ to: b.agent.id, text: 'B, what is 2+2?' })

  const bInbox = messageRepo.listInbox(env.db, b.agent.id)
  expect(bInbox).toHaveLength(1)
  const originalMsgId = bInbox[0]?.id
  expect(originalMsgId).toBeDefined()

  // B replies with reply_to pointer
  const bHandlers = messagingTools(createDbMessagingHost(env.db), b.agent.id)
  const bSend = findHandler(bHandlers, 'send_message')
  await bSend.invoke({ to: a.agent.id, text: '4', reply_to: originalMsgId })

  // A can see B's reply in its own inbox
  const aInbox = messageRepo.listInbox(env.db, a.agent.id)
  expect(aInbox).toHaveLength(1)
  expect(aInbox[0]?.replyTo).toBe(originalMsgId)
  const payload = JSON.parse(aInbox[0]?.payload ?? '{}')
  expect(payload.text).toBe('4')
})

test('wait_for_reply resolves when a reply arrives', async () => {
  const a = makeAgent(env, 'A')
  const b = makeAgent(env, 'B')

  const sent = messageRepo.send(env.db, {
    from: a.agent.id,
    to: b.agent.id,
    payload: JSON.stringify({ text: 'ping' }),
  })

  const reply = setTimeout(() => {
    messageRepo.send(env.db, {
      from: b.agent.id,
      to: a.agent.id,
      payload: JSON.stringify({ text: 'pong' }),
      replyTo: sent.id,
    })
  }, 100)

  const handlers = messagingTools(createDbMessagingHost(env.db), a.agent.id)
  const wait = findHandler(handlers, 'wait_for_reply')
  const result = await wait.invoke({ message_id: sent.id, timeout_ms: 2000, poll_ms: 50 })
  clearTimeout(reply)

  expect(result).toContain('pong')
})

test('wait_for_reply times out cleanly when no reply arrives', async () => {
  const a = makeAgent(env, 'A')
  const b = makeAgent(env, 'B')
  const sent = messageRepo.send(env.db, {
    from: a.agent.id,
    to: b.agent.id,
    payload: JSON.stringify({ text: 'ping' }),
  })

  const handlers = messagingTools(createDbMessagingHost(env.db), a.agent.id)
  const wait = findHandler(handlers, 'wait_for_reply')
  const result = await wait.invoke({ message_id: sent.id, timeout_ms: 200, poll_ms: 50 })
  expect(result).toContain('no reply within')
})

test('send_message rejects unknown recipient', async () => {
  const a = makeAgent(env, 'A')
  const handlers = messagingTools(createDbMessagingHost(env.db), a.agent.id)
  const send = findHandler(handlers, 'send_message')
  await expect(send.invoke({ to: 'nope', text: 'hi' })).rejects.toThrow()
})

test('a message sent with wake: false waits unread without waking its recipient', async () => {
  const a = makeAgent(env, 'A')
  const b = makeAgent(env, 'B')
  const send = findHandler(
    messagingTools(createDbMessagingHost(env.db), a.agent.id),
    'send_message',
  )
  expect(
    String(await send.invoke({ to: b.agent.id, text: 'FYI: the API moved', wake: false })),
  ).toContain("waits for the recipient's next turn")
  expect(messageRepo.listRecipientsWithUnread(env.db)).toEqual([])
  expect(messageRepo.unreadCount(env.db, b.agent.id)).toBe(1)
  // A message that does wake it does, and the quiet one is read with it.
  await send.invoke({ to: b.agent.id, text: 'please review' })
  expect(messageRepo.listRecipientsWithUnread(env.db)).toEqual([b.agent.id])
  expect(
    messageRepo
      .drainUnreadForAgent(env.db, b.agent.id)
      .map((m) => messageRepo.messageText(m.payload)),
  ).toEqual(['FYI: the API moved', 'please review'])
})

test('wait_for_reply waits for the replies to several messages and names the missing ones', async () => {
  const a = makeAgent(env, 'A')
  const b = makeAgent(env, 'B')
  const c = makeAgent(env, 'C')
  const host = createDbMessagingHost(env.db)
  const tools = messagingTools(host, a.agent.id)
  const first = messageRepo.send(env.db, {
    from: a.agent.id,
    to: b.agent.id,
    payload: '{"text":"q1"}',
  })
  const second = messageRepo.send(env.db, {
    from: a.agent.id,
    to: c.agent.id,
    payload: '{"text":"q2"}',
  })
  messageRepo.send(env.db, {
    from: b.agent.id,
    to: a.agent.id,
    payload: '{"text":"answer one"}',
    replyTo: first.id,
  })
  const waited = String(
    await findHandler(tools, 'wait_for_reply').invoke({
      message_ids: [first.id, second.id],
      timeout_ms: 300,
      poll_ms: 20,
    }),
  )
  expect(waited).toContain(`to ${first.id}: answer one`)
  expect(waited).toContain(`no reply within 300ms to ${second.id}`)
})
