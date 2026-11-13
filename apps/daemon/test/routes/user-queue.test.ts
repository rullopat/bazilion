import type { UserQueueItem } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createApp } from '../../src/app.ts'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as providerModels from '../../src/core/repos/providerModels.ts'
import * as providerState from '../../src/core/repos/providerState.ts'
import * as queue from '../../src/core/repos/user-queue.ts'
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
function request(path = '', method = 'GET', body?: unknown, agent = agentId) {
  return createApp().request(`/api/agents/${agent}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
const input = {
  message: 'queued text',
  attachments: [{ name: 'source.txt', mimeType: 'text/plain', data: 'eA==' }],
}

test('list, add, edit and remove follow-ups; New conversation is not blocked by them', async () => {
  expect((await createApp().request(`/api/agents/${agentId}/queue`)).status).toBe(401)
  const accepted = await request('/queue', 'POST', input)
  expect(accepted.status).toBe(202)
  expect(accepted.headers.get('cache-control')).toBe('no-store')
  const item = (await accepted.json()) as UserQueueItem
  expect(item).toMatchObject({
    status: 'pending',
    text: 'queued text',
    attachments: [{ name: 'source.txt', byteLength: 1 }],
  })
  expect(await (await request('/queue')).json()).toMatchObject({
    paused: false,
    turnActive: false,
    items: [{ id: item.id }],
  })
  expect((await request('/conversations', 'POST', {})).status).toBe(200)
  // Editing replaces the text; the attachments stay.
  const edited = await request(`/queue/${item.id}`, 'PATCH', { message: 'edited', attachments: [] })
  expect(await edited.json()).toMatchObject({
    text: 'edited',
    attachments: [{ name: 'source.txt' }],
  })
  // The CLI may name the Agent by an id prefix.
  expect(
    await (await request('/queue', 'GET', undefined, agentId.slice(0, 8))).json(),
  ).toMatchObject({ items: [{ id: item.id }] })
  expect((await request(`/queue/${item.id}`, 'DELETE')).status).toBe(200)
  expect(await (await request('/queue')).json()).toMatchObject({ items: [] })
  expect((await request(`/queue/${item.id}`, 'DELETE')).status).toBe(409)
  expect((await request('/queue', 'POST', { message: '', attachments: [] })).status).toBe(400)
  expect((await request('/queue', 'GET', undefined, 'missing')).status).toBe(404)
})

test('a running follow-up cannot be edited or removed', async () => {
  const item = (await (await request('/queue', 'POST', input)).json()) as UserQueueItem
  queue.claim(env.db, agentId)
  expect((await request(`/queue/${item.id}`, 'PATCH', { message: 'late' })).status).toBe(409)
  expect((await request(`/queue/${item.id}`, 'DELETE')).status).toBe(409)
})

test('the list reports a running turn, and Stop cancels a running follow-up', async () => {
  expect(await (await request('/queue')).json()).toEqual({
    paused: false,
    turnActive: false,
    items: [],
  })
  const running = (await (await request('/queue', 'POST', input)).json()) as UserQueueItem
  const waiting = (await (await request('/queue', 'POST', input)).json()) as UserQueueItem
  // The pump claims the head and runs it as a turn of the Agent, like any other turn.
  queue.claim(env.db, agentId)
  const controller = new AbortController()
  registerAgent(agentId, controller)
  expect(await (await request('/queue')).json()).toMatchObject({
    turnActive: true,
    items: [
      { id: running.id, status: 'running' },
      { id: waiting.id, status: 'pending' },
    ],
  })
  expect(await (await request('/cancel', 'POST')).json()).toEqual({
    cancelled: true,
    queuePaused: true,
  })
  expect(controller.signal.aborted).toBe(true)
  unregisterAgent(agentId)
  expect(await (await request('/queue')).json()).toMatchObject({ paused: true, turnActive: false })
})

test('invalid input gets its own message', async () => {
  const item = (await (await request('/queue', 'POST', { message: 'text only' })).json()) as {
    id: string
  }
  const missing = await request(`/queue/${item.id}`, 'PATCH', {})
  expect(missing.status).toBe(400)
  expect(await missing.json()).toEqual({ error: 'message must be a string' })
  const emptied = await request(`/queue/${item.id}`, 'PATCH', { message: ' ' })
  expect(await emptied.json()).toMatchObject({ error: 'Follow-up is empty' })
  expect(queue.get(env.db, agentId, item.id)?.text).toBe('text only')
  const malformed = await createApp().request(`/api/agents/${agentId}/queue`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: '{not json',
  })
  // A body that is not JSON carries no message.
  expect(malformed.status).toBe(400)
  expect(await malformed.json()).toEqual({ error: 'message must be a string' })
})

test('pause and resume; Stop pauses the queue only when follow-ups wait', async () => {
  expect(await (await request('/queue/control', 'POST', { paused: true })).json()).toEqual({
    paused: true,
  })
  expect(queue.isPaused(env.db, agentId)).toBe(true)
  await request('/queue/control', 'POST', { paused: false })
  expect((await request('/queue/control', 'POST', {})).status).toBe(400)

  expect((await request('/cancel', 'POST')).status).toBe(409)
  const controller = new AbortController()
  registerAgent(agentId, controller)
  expect(await (await request('/cancel', 'POST')).json()).toEqual({
    cancelled: true,
    queuePaused: false,
  })
  expect(controller.signal.aborted).toBe(true)
  await request('/queue', 'POST', input)
  expect(await (await request('/cancel', 'POST')).json()).toEqual({
    cancelled: true,
    queuePaused: true,
  })
  expect(queue.isPaused(env.db, agentId)).toBe(true)
})
