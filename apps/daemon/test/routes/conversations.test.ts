import { randomUUID } from 'node:crypto'
import { appendFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatContextResponse, Conversation } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createApp } from '../../src/app.ts'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as conversations from '../../src/core/repos/conversations.ts'
import * as providerModels from '../../src/core/repos/providerModels.ts'
import * as providerState from '../../src/core/repos/providerState.ts'
import * as webTokens from '../../src/core/repos/webTokens.ts'
import { registerAgent, unregisterAgent } from '../../src/lib/agent-cancel.ts'
import {
  titleConversationFromMessage,
  titleFromMessage,
} from '../../src/lib/conversation-target.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
let token: string
let agentId: string
vi.mock('../../src/lib/ctx.ts', () => ({
  getCtx: () => ({ db: env.db, paths: env.paths, authToken: token }),
}))
beforeEach(() => {
  env = makeTestEnv()
  token = webTokens.create(env.db, 'test', { kind: 'bootstrap' }).token
  providerState.setEnabled(env.db, 'lmstudio', true)
  providerModels.replace(env.db, 'lmstudio', ['test'])
  createProfile(env.db, env.paths, { id: 'test', defaultModel: 'lmstudio:test' })
  agentId = spawnAgent(env.db, env.paths, { profileId: 'test', teamId: env.teamId }).id
})
afterEach(() => {
  unregisterAgent(agentId)
  env.cleanup()
})
function request(path = '', method = 'GET', body?: unknown, base = 'conversations') {
  return createApp().request(`/api/agents/${agentId}/${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
async function start(title?: string): Promise<Conversation> {
  const response = await request('', 'POST', title ? { title } : {})
  expect(response.status).toBe(200)
  return (await response.json()) as Conversation
}

test('the library lists, starts, reads and renames conversations; reading selects nothing', async () => {
  expect((await createApp().request(`/api/agents/${agentId}/conversations`)).status).toBe(401)
  expect(await (await request()).json()).toMatchObject({ total: 0, selectedId: null })
  const first = await start('First')
  expect(first.title).toBe('First')
  const second = await start()
  expect(await (await request(`/${first.id}`)).json()).toMatchObject({
    messages: [],
    conversation: { id: first.id },
  })
  expect(await (await request()).json()).toMatchObject({ total: 2, selectedId: second.id })
  const renamed = await request(`/${first.id}`, 'PATCH', { title: 'Earlier task' })
  expect(await renamed.json()).toMatchObject({ conversation: { title: 'Earlier task' } })
  expect((await request(`/${first.id}`, 'PATCH', { title: '' })).status).toBe(400)
  expect((await request(`/${randomUUID()}`)).status).toBe(404)
})

test('a refused title starts nothing; the Agent may be named by an id prefix', async () => {
  const sessions = join(env.paths.agentDir(agentId), 'sessions')
  const before = readdirSync(sessions)
  for (const title of ['x'.repeat(201), 'line\nbreak']) {
    const refused = await request('', 'POST', { title })
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({ error: expect.stringContaining('title') })
  }
  expect(readdirSync(sessions)).toEqual(before)
  const created = await start('Prefixed')
  const listed = await createApp().request(`/api/agents/${agentId.slice(0, 8)}/conversations`, {
    headers: { authorization: `Bearer ${token}` },
  })
  expect(await listed.json()).toMatchObject({ total: 1, selectedId: created.id })
})

test('an earlier conversation can be continued: selecting it makes it the active one', async () => {
  const first = await start('First')
  const second = await start('Second')
  const selected = await request(`/${first.id}/select`, 'POST')
  expect(selected.status).toBe(200)
  expect(await selected.json()).toMatchObject({ conversation: { id: first.id, title: 'First' } })
  expect(await (await request()).json()).toMatchObject({ total: 2, selectedId: first.id })
  expect((await request(`/${randomUUID()}/select`, 'POST')).status).toBe(404)

  // Not while a turn runs, and not when the transcript is gone.
  registerAgent(agentId, new AbortController())
  expect((await request(`/${second.id}/select`, 'POST')).status).toBe(409)
  unregisterAgent(agentId)
  unlinkSync(join(env.paths.agentDir(agentId), 'sessions', `${second.id}.jsonl`))
  const unreadable = await request(`/${second.id}/select`, 'POST')
  expect(unreadable.status).toBe(409)
  expect(await (await request()).json()).toMatchObject({ selectedId: first.id })
})

test("the operator's first message names a conversation that still has its numbered title", async () => {
  const numbered = await start()
  expect(numbered.title).toBe('Conversation 1')
  const titled = () => conversations.get(env.db, agentId, numbered.id)?.title
  const name = (id: string, message: string) =>
    titleConversationFromMessage(env.db, env.paths, agentId, id, message)
  name(numbered.id, '   ')
  expect(titled()).toBe('Conversation 1')
  name(
    numbered.id,
    '\nAdd a dark-mode toggle to the landing page and make sure nothing else breaks.\nThanks',
  )
  expect(titled()).toBe('Add a dark-mode toggle to the landing page and make sure…')
  // Named once: later messages and a title the operator chose are left alone.
  name(numbered.id, 'Something else')
  expect(titled()).toBe('Add a dark-mode toggle to the landing page and make sure…')
  const chosen = await start('Conversation 9')
  await request(`/${chosen.id}`, 'PATCH', { title: 'Conversation 7' })
  name(chosen.id, 'Hello')
  expect(conversations.get(env.db, agentId, chosen.id)?.title).toBe('Conversation 7')
  // A conversation that already has turns keeps its numbered title: only a first message names.
  const used = await start()
  appendFileSync(
    join(env.paths.agentDir(agentId), 'sessions', `${used.id}.jsonl`),
    `${JSON.stringify({ type: 'message', id: 'entry-1', parentId: null })}\n`,
  )
  name(used.id, 'A later message')
  expect(conversations.get(env.db, agentId, used.id)?.title).toBe(used.title)

  expect(titleFromMessage('short')).toBe('short')
  expect(titleFromMessage('a\tb   c')).toBe('a b c')
  expect(titleFromMessage('x'.repeat(80))).toBe(`${'x'.repeat(60)}…`)
  expect(titleFromMessage('\n\n')).toBeNull()
})

test('a new conversation waits for the running turn', async () => {
  registerAgent(agentId, new AbortController())
  const busy = await request('', 'POST', {})
  expect(busy.status).toBe(409)
  expect(await busy.json()).toEqual({
    error: 'The Agent is busy with another turn.',
    code: 'agent_turn_active',
  })
  unregisterAgent(agentId)
  await start()
})

test('missing history is unavailable, never recreated, and a new conversation recovers', async () => {
  const created = await start()
  unlinkSync(join(env.paths.agentDir(agentId), 'sessions', `${created.id}.jsonl`))
  expect((await request(`/${created.id}`)).status).toBe(409)
  for (const path of ['/head', '/messages']) {
    const response = await request(path, 'GET', undefined, 'sessions')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { head?: unknown }
    expect(path === '/head' ? body : body.head).toMatchObject({
      unavailable: true,
      conversationId: created.id,
    })
  }
  const next = await start()
  expect(await (await request()).json()).toMatchObject({ total: 2, selectedId: next.id })
  expect((await request(`/${created.id}`)).status).toBe(409)
})

test('a truncate aimed at a conversation the Agent switched away from is refused', async () => {
  const first = await start()
  await start()
  const truncate = await request(
    '/truncate',
    'POST',
    { keepCount: 0, conversationId: first.id },
    'chat',
  )
  expect(truncate.status).toBe(409)
  expect(await truncate.json()).toEqual({
    error: 'The Agent switched to another conversation. Reload before trying again.',
  })
  registerAgent(agentId, new AbortController())
  expect((await request('/compact', 'POST', {}, 'chat')).status).toBe(409)
  expect((await request('/truncate', 'POST', { keepCount: 0 }, 'chat')).status).toBe(409)
})

test('the context breakdown reports the size of the conversation file on disk', async () => {
  const created = await start()
  const response = await request('/context', 'GET', undefined, 'chat')
  expect(response.status).toBe(200)
  const { history } = (await response.json()) as ChatContextResponse
  const file = join(env.paths.agentDir(agentId), 'sessions', `${created.id}.jsonl`)
  expect(history.bytes).toBeGreaterThan(0)
  expect(history.bytes).toBe(statSync(file).size)
})
