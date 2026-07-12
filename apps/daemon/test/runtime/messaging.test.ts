// Unit tests for the messaging `ToolHandler`s that Bazilion exposes as pi
// customTools. Called directly here (not through the LLM loop) because the
// tests are about tool *behaviour* — DB side effects, polling, error paths —
// not about round-tripping through pi's agent loop.

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ResolvedAgent } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test } from 'vitest'
import {
  agentRepo,
  type BazilionDb,
  createProfile,
  messageRepo,
  openInMemoryDb,
  type Paths,
  registerTeam,
  resolveAgent,
  resolvePaths,
  runMigrations,
  spawnAgent,
} from '../../src/core/index.ts'
import { messagingTools } from '../../src/runtime/tools/messaging.ts'
import type { ToolHandler } from '../../src/runtime/tools/types.ts'
import type { MessagingHost } from '../../src/runtime/worker/ipc-protocol.ts'

function dbHost(db: BazilionDb): MessagingHost {
  return {
    agentExists: (id) => agentRepo.get(db, id) !== null,
    sendMessage: (input) => ({ messageId: messageRepo.send(db, input).id }),
    listInbox: (id, opts) => messageRepo.listInbox(db, id, opts),
    markRead: (id) => messageRepo.markRead(db, id),
    findReplies: (id, replyTo) => messageRepo.findReplies(db, id, replyTo),
    approvalStatus: () => null,
  }
}

interface Env {
  home: string
  paths: Paths
  db: BazilionDb
  teamId: string
  cleanup(): void
}

function makeEnv(): Env {
  const home = mkdtempSync(join(tmpdir(), 'bazilion-msg-'))
  const paths = resolvePaths(home)
  for (const d of [
    paths.profilesDir,
    paths.agentsDir,
    paths.skillsDir,
    paths.logsDir,
    paths.teamsDir,
  ]) {
    mkdirSync(d, { recursive: true })
  }
  const db = openInMemoryDb()
  runMigrations(db)
  const g = registerTeam(db, { id: 'test-team', name: 'test' }, paths)
  return {
    home,
    paths,
    db,
    teamId: g.id,
    cleanup() {
      db.close()
      rmSync(home, { recursive: true, force: true })
    },
  }
}

function makeAgent(env: Env, name: string): ResolvedAgent {
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

let env: Env
beforeEach(() => {
  env = makeEnv()
  createProfile(env.db, env.paths, {
    id: 'p',
    defaultModel: 'mock:m',
  })
})
afterEach(() => env.cleanup())

test('send_message tool inserts a row addressed to the recipient', async () => {
  const a = makeAgent(env, 'A')
  const b = makeAgent(env, 'B')
  const handlers = messagingTools(dbHost(env.db), a.agent.id)
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

  const handlers = messagingTools(dbHost(env.db), b.agent.id)
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
  const aHandlers = messagingTools(dbHost(env.db), a.agent.id)
  const aSend = findHandler(aHandlers, 'send_message')
  await aSend.invoke({ to: b.agent.id, text: 'B, what is 2+2?' })

  const bInbox = messageRepo.listInbox(env.db, b.agent.id)
  expect(bInbox).toHaveLength(1)
  const originalMsgId = bInbox[0]?.id
  expect(originalMsgId).toBeDefined()

  // B replies with reply_to pointer
  const bHandlers = messagingTools(dbHost(env.db), b.agent.id)
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

  const handlers = messagingTools(dbHost(env.db), a.agent.id)
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

  const handlers = messagingTools(dbHost(env.db), a.agent.id)
  const wait = findHandler(handlers, 'wait_for_reply')
  const result = await wait.invoke({ message_id: sent.id, timeout_ms: 200, poll_ms: 50 })
  expect(result).toContain('no reply within')
})

test('send_message rejects unknown recipient', async () => {
  const a = makeAgent(env, 'A')
  const handlers = messagingTools(dbHost(env.db), a.agent.id)
  const send = findHandler(handlers, 'send_message')
  await expect(send.invoke({ to: 'nope', text: 'hi' })).rejects.toThrow()
})
