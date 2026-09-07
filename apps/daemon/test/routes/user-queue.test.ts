import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createApp } from '../../src/app.ts'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as conversations from '../../src/core/repos/conversations.ts'
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
  vi.stubEnv('BAZILION_TEAM_POLICY_ENFORCEMENT', 'off')
  token = webTokens.create(env.db, 'test', { kind: 'bootstrap' }).token
  providerState.setEnabled(env.db, 'lmstudio', true)
  providerModels.replace(env.db, 'lmstudio', ['test'])
  createProfile(env.db, env.paths, { id: 'test', defaultModel: 'lmstudio:test' })
  agentId = spawnAgent(env.db, env.paths, { profileId: 'test', teamId: env.teamId }).id
})
afterEach(() => {
  unregisterAgent(agentId)
  vi.unstubAllEnvs()
  env.cleanup()
})
function request(path = '', method = 'GET', body?: unknown) {
  return createApp().request(`/api/agents/${agentId}/queue${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
function input() {
  return {
    requestId: randomUUID(),
    expectedSelection: conversations.selection(env.db, agentId),
    message: 'queued text',
    attachments: [{ name: 'source.txt', mimeType: 'text/plain', data: 'eA==' }],
  }
}
test('authenticated queue keeps retries stable and prevents New while input is pending', async () => {
  expect((await createApp().request(`/api/agents/${agentId}/queue`)).status).toBe(401)
  const body = input()
  const accepted = await request('', 'POST', body)
  expect(accepted.status).toBe(202)
  expect(accepted.headers.get('cache-control')).toBe('no-store')
  const item = await accepted.json()
  expect(item).toMatchObject({ id: body.requestId, status: 'pending' })
  expect((await request('', 'POST', body)).status).toBe(202)
  expect(await (await request()).json()).toMatchObject({ total: 1 })
  expect(await (await request(`/${body.requestId}/input`)).json()).toEqual({
    message: body.message,
    attachments: body.attachments,
  })
  const next = await createApp().request(`/api/agents/${agentId}/conversations`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      requestId: randomUUID(),
      expectedSelection: conversations.selection(env.db, agentId),
    }),
  })
  expect(next.status).toBe(409)
  expect((await request('', 'POST', { ...body, message: 'different' })).status).toBe(409)
})
test('editing creates a fresh attempt and stale remove cannot cancel it', async () => {
  const original = input()
  await request('', 'POST', original)
  const replacement = { ...input(), message: 'edited', expectedRevision: 1 }
  expect((await request(`/${original.requestId}`, 'PATCH', replacement)).status).toBe(200)
  expect(await (await request(`/${original.requestId}`)).json()).toMatchObject({
    status: 'superseded',
  })
  expect(
    (await request(`/${replacement.requestId}`, 'DELETE', { expectedRevision: 0 })).status,
  ).toBe(409)
  expect(
    (await request(`/${replacement.requestId}`, 'DELETE', { expectedRevision: 1 })).status,
  ).toBe(200)
  expect(await (await request()).json()).toMatchObject({ total: 0 })
})
test('Stop persists pause before cancelling and stale Stop cannot abort a turn', async () => {
  const controller = new AbortController()
  registerAgent(agentId, controller)
  expect((await request('/stop', 'POST', { expectedRevision: 5 })).status).toBe(409)
  expect(controller.signal.aborted).toBe(false)
  const stopped = await request('/stop', 'POST', { expectedRevision: 0 })
  expect(stopped.status).toBe(200)
  expect(await stopped.json()).toMatchObject({
    control: { paused: true, reason: 'operator_stop' },
    cancelled: true,
  })
  expect(controller.signal.aborted).toBe(true)
  expect((await request('/control', 'POST', { paused: false, expectedRevision: 1 })).status).toBe(
    200,
  )
})
test('uncertain input requires explicit reconciliation, remains paused and never retries', async () => {
  const body = input()
  await request('', 'POST', body)
  queue.claim(env.db, agentId)
  queue.recoverInterrupted(env.db)
  const item = queue.get(env.db, agentId, body.requestId)
  if (!item) throw new Error('Missing queue item')
  expect((await request('/control', 'POST', { paused: false, expectedRevision: 1 })).status).toBe(
    409,
  )
  expect(
    (await request(`/${item.id}/reconcile`, 'POST', { expectedRevision: item.revision })).status,
  ).toBe(400)
  expect(
    (
      await request(`/${item.id}/reconcile`, 'POST', {
        expectedRevision: item.revision,
        acknowledged: true,
      })
    ).status,
  ).toBe(200)
  expect(queue.control(env.db, agentId).paused).toBe(true)
  expect(await (await request('', 'POST', body)).json()).toMatchObject({
    id: item.id,
    status: 'cancelled',
  })
  expect(queue.claim(env.db, agentId)).toBeNull()
})
