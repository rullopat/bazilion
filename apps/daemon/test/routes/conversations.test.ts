import { randomUUID } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createApp } from '../../src/app.ts'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as providerModels from '../../src/core/repos/providerModels.ts'
import * as providerState from '../../src/core/repos/providerState.ts'
import * as webTokens from '../../src/core/repos/webTokens.ts'
import { registerAgent, unregisterAgent } from '../../src/lib/agent-cancel.ts'
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
function request(path = '', method = 'GET', body?: unknown) {
  return createApp().request(`/api/agents/${agentId}/conversations${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
function input() {
  return { requestId: randomUUID(), expectedSelection: { conversationId: null, revision: 0 } }
}

test('authenticated library exposes empty history and explicit selection without changing it on read', async () => {
  expect((await createApp().request(`/api/agents/${agentId}/conversations`)).status).toBe(401)
  expect(await (await request()).json()).toMatchObject({
    total: 0,
    selection: { conversationId: null, revision: 0 },
  })
  const create = input()
  const response = await request('', 'POST', create)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await (await request(`/${create.requestId}`)).json()).toMatchObject({
    messages: [],
    conversation: { id: create.requestId },
  })
  expect(await (await request()).json()).toMatchObject({
    total: 1,
    selection: { conversationId: create.requestId, revision: 1 },
  })
  expect((await request(`/${randomUUID()}`)).status).toBe(404)
})

test('stale selection and active Agent return recoverable conflicts', async () => {
  expect((await request('', 'POST', input())).status).toBe(200)
  expect((await request('', 'POST', input())).status).toBe(409)
  registerAgent(agentId, new AbortController())
  expect((await request('', 'POST', input())).status).toBe(409)
  expect(await (await request()).json()).toMatchObject({ total: 1 })
})

test('missing history is unavailable and is never recreated by a read', async () => {
  const create = input()
  await request('', 'POST', create)
  unlinkSync(join(env.paths.agentDir(agentId), 'sessions', `${create.requestId}.jsonl`))
  expect((await request(`/${create.requestId}`)).status).toBe(409)
  expect(await (await request()).json()).toMatchObject({
    total: 1,
    selection: { conversationId: create.requestId },
  })
})

test('chat rejects absent or stale selection before starting a turn', async () => {
  const send = (body: unknown) =>
    createApp().request(`/api/agents/${agentId}/chat`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  const absent = await send({ message: 'must not start' })
  expect(absent.status).toBe(409)
  expect(await absent.json()).toMatchObject({ code: 'conversation_selection_required' })
  const created = input()
  await request('', 'POST', created)
  const stale = await send({
    message: 'must not start',
    expectedSelection: { conversationId: null, revision: 0 },
  })
  expect(stale.status).toBe(409)
  expect(await stale.json()).toMatchObject({
    code: 'conversation_conflict',
    selection: { conversationId: created.requestId, revision: 1 },
  })
  expect(await (await request(`/${created.requestId}`)).json()).toMatchObject({ messages: [] })
})

test('compact and edit reject busy or stale selection before opening a session', async () => {
  const created = input()
  await request('', 'POST', created)
  const control = (action: string, expectedSelection: unknown) =>
    createApp().request(`/api/agents/${agentId}/chat/${action}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ keepCount: 0, expectedSelection }),
    })
  for (const action of ['compact', 'truncate']) {
    expect((await control(action, { conversationId: null, revision: 0 })).status).toBe(409)
    registerAgent(agentId, new AbortController())
    expect((await control(action, { conversationId: created.requestId, revision: 1 })).status).toBe(
      409,
    )
    unregisterAgent(agentId)
  }
  expect(await (await request(`/${created.requestId}`)).json()).toMatchObject({ messages: [] })
  expect((await control('reset', { conversationId: created.requestId, revision: 1 })).status).toBe(
    404,
  )
})

test('unavailable current history remains recoverable through New conversation', async () => {
  const created = input()
  await request('', 'POST', created)
  unlinkSync(join(env.paths.agentDir(agentId), 'sessions', `${created.requestId}.jsonl`))
  for (const path of ['head', 'messages']) {
    const response = await createApp().request(`/api/agents/${agentId}/sessions/${path}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { head?: unknown }
    expect(path === 'head' ? body : body.head).toMatchObject({
      unavailable: true,
      selection: { conversationId: created.requestId },
    })
  }
  expect(
    (
      await request('', 'POST', {
        requestId: randomUUID(),
        expectedSelection: { conversationId: created.requestId, revision: 1 },
      })
    ).status,
  ).toBe(200)
  expect(await (await request()).json()).toMatchObject({ total: 2 })
  expect((await request(`/${created.requestId}`)).status).toBe(409)
})

test('lost creation response can be reconciled while a later turn is active', async () => {
  const original = input()
  expect((await request('', 'POST', original)).status).toBe(200)
  registerAgent(agentId, new AbortController())
  const retried = await request('', 'POST', original)
  expect(retried.status).toBe(200)
  expect(await retried.json()).toMatchObject({
    conversation: { id: original.requestId },
    selection: { conversationId: original.requestId, revision: 1 },
  })
  expect((await request('', 'POST', { ...original, title: 'different intent' })).status).toBe(409)
})
