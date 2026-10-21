import type {
  PrivateImageCaptureListResponse,
  PrivateImageRecoveryResponse,
} from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createApp } from '../../src/app.ts'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as operations from '../../src/core/repos/image-generations.ts'
import * as providerModels from '../../src/core/repos/providerModels.ts'
import * as providerState from '../../src/core/repos/providerState.ts'
import * as results from '../../src/core/repos/results.ts'
import * as webTokens from '../../src/core/repos/webTokens.ts'
import { registerTeam } from '../../src/core/team/register.ts'
import { registerAgent, unregisterAgent } from '../../src/lib/agent-cancel.ts'
import { authorizeHttpChatFrame, CommunicationPendingError } from '../../src/lib/communication.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhK0AAAAASUVORK5CYII=',
  'base64',
)
let env: TestEnv, token: string, agentId: string
vi.mock('../../src/lib/ctx.ts', () => ({
  getCtx: () => ({ db: env.db, paths: env.paths, authToken: token }),
}))
beforeEach(() => {
  env = makeTestEnv()
  vi.stubEnv('BAZILION_TEAM_POLICY_ENFORCEMENT', 'on')
  token = webTokens.create(env.db, 'test', { kind: 'bootstrap' }).token
  providerState.setEnabled(env.db, 'lmstudio', true)
  providerModels.replace(env.db, 'lmstudio', ['test'])
  createProfile(env.db, env.paths, {
    id: 'producer',
    defaultModel: 'lmstudio:test',
    communicationDefaults: {
      userInput: true,
      userOutput: true,
      outsideTeamInput: false,
      outsideTeamOutput: false,
      peerDefault: 'allow_all',
    },
  })
  agentId = spawnAgent(env.db, env.paths, { profileId: 'producer', teamId: env.teamId }).id
})
afterEach(() => {
  unregisterAgent(agentId)
  vi.unstubAllEnvs()
  env.cleanup()
})
function capture(call = 'capture') {
  const op: operations.ImageOperation = {
    agentId,
    teamId: env.teamId,
    sessionId: 'session',
    toolCallId: call,
    turnId: 'turn',
    requestSha256: 'a'.repeat(64),
    model: 'openai:gpt-image-2',
  }
  return env.db.raw.transaction(() => {
    operations.admit(env.db, op)
    const result = results.publish(env.db, {
      agentId,
      teamId: env.teamId,
      sessionId: op.sessionId,
      toolCallId: call,
      name: 'private-prompt-filename.png',
      mimeType: 'image/png',
      imageModel: op.model,
      bytes: png,
    })
    operations.settle(env.db, op, 'completed')
    return result
  })()
}
function request(path: string, body?: unknown, auth = true) {
  return createApp().request(`/api/results${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(auth ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
function recover(id: string) {
  return request(`/private-images/${id}/recover`, { teamId: env.teamId })
}
function discard(id: string) {
  return request(`/private-images/${id}/discard`, { teamId: env.teamId, confirm: true })
}
function edge(posture: 'allow' | 'approval_required' | 'deny') {
  if (posture === 'deny') {
    env.db.raw.run(
      "DELETE FROM team_policy_edges WHERE team_id = ? AND source_kind = 'agent' AND source_id = ? AND target_kind = 'user'",
      [env.teamId, agentId],
    )
    return
  }
  env.db.raw.run(
    "UPDATE team_policy_edges SET posture = ? WHERE team_id = ? AND source_kind = 'agent' AND source_id = ? AND target_kind = 'user'",
    [posture, env.teamId, agentId],
  )
}
async function inventory(query: string) {
  return (await (
    await request(`/private-images?${query}`)
  ).json()) as PrivateImageCaptureListResponse
}
async function heldRecovery(id: string) {
  const value = (await (await recover(id)).json()) as PrivateImageRecoveryResponse
  expect(value).toMatchObject({ status: 'approval_required', approvalId: expect.any(String) })
  if (value.status !== 'approval_required') throw new Error('Expected a held image recovery')
  return value
}
function approvalCount() {
  return env.db.raw
    .query<{ n: number }, []>('SELECT count(*) AS n FROM communication_approvals')
    .get()?.n
}

test('private image inventory requires owner auth and exposes only approved minimal metadata', async () => {
  const row = capture()
  expect((await request(`/private-images?teamId=${env.teamId}`, undefined, false)).status).toBe(401)
  expect(
    (await request(`/private-images/${row.id}/recover`, { teamId: env.teamId }, false)).status,
  ).toBe(401)
  expect(
    (
      await request(
        `/private-images/${row.id}/discard`,
        { teamId: env.teamId, confirm: true },
        false,
      )
    ).status,
  ).toBe(401)
  const response = await request(`/private-images?teamId=${env.teamId}`)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const body = (await response.json()) as PrivateImageCaptureListResponse
  expect(body).toMatchObject({ total: 1, privateBytes: png.length, retainedBytes: png.length })
  expect(Object.keys(body.captures[0] ?? {}).sort()).toEqual(
    ['id', 'teamId', 'agentId', 'createdAt', 'byteLength'].sort(),
  )
  for (const secret of [
    row.name,
    row.sha256,
    row.imageModel,
    row.sessionId,
    png.toString('base64'),
  ])
    expect(JSON.stringify(body)).not.toContain(secret)
  for (const suffix of ['', '/preview', '/download', '/source'])
    expect((await request(`/${row.id}${suffix}`)).status).toBe(404)
})

test('inventory is bounded and scoped to original Team and optional producing Agent', async () => {
  capture('one')
  capture('two')
  const other = registerTeam(env.db, { id: 'other' }, env.paths)
  const first = await inventory(`teamId=${env.teamId}&limit=1`)
  const second = await inventory(`teamId=${env.teamId}&limit=1&offset=1`)
  expect(first.total).toBe(2)
  expect(second.total).toBe(2)
  expect(first.captures).toHaveLength(1)
  expect(second.captures).toHaveLength(1)
  expect(first.captures[0]?.id).not.toBe(second.captures[0]?.id)
  expect((await inventory(`teamId=${other.id}`)).total).toBe(0)
  expect((await inventory(`teamId=${env.teamId}&agentId=other-agent`)).total).toBe(0)
})

test('inventory and actions reject unknown fields, duplicate scope, invalid bounds and unconfirmed discard', async () => {
  const row = capture()
  for (const query of [
    '',
    `teamId=${env.teamId}&limit=101`,
    `teamId=${env.teamId}&offset=-1`,
    `teamId=${env.teamId}&limit=NaN`,
    `teamId=${env.teamId}&agentId=`,
    `teamId=${env.teamId}&teamId=${env.teamId}`,
    `teamId=${env.teamId}&prompt=leak`,
  ])
    expect((await request(`/private-images?${query}`)).status).toBe(400)
  for (const body of [
    {},
    [],
    { teamId: env.teamId, model: 'other' },
    { teamId: env.teamId, confirm: true },
  ])
    expect((await request(`/private-images/${row.id}/recover`, body)).status).toBe(400)
  for (const body of [
    { teamId: env.teamId },
    { teamId: env.teamId, confirm: false },
    { teamId: env.teamId, confirm: true, all: true },
  ])
    expect((await request(`/private-images/${row.id}/discard`, body)).status).toBe(400)
  expect(results.readCaptured(env.db, row.id)).toEqual(png)
})

test('explicit image recovery uses current egress policy, is idempotent and never regenerates', async () => {
  const row = capture()
  expect(await (await recover(row.id)).json()).toEqual({ resultId: row.id, status: 'released' })
  expect(await (await recover(row.id)).json()).toEqual({
    resultId: row.id,
    status: 'already_released',
  })
  expect(Buffer.from(await (await request(`/${row.id}/download`)).arrayBuffer())).toEqual(png)
  expect(
    env.db.raw.query<{ n: number }, []>('SELECT count(*) AS n FROM image_generations').get()?.n,
  ).toBe(1)
  expect(approvalCount()).toBe(0)
  expect((await discard(row.id)).status).toBe(409)
})

test('denied recovery keeps bytes private while confirmed discard frees quota without disclosure', async () => {
  const row = capture()
  edge('deny')
  expect(await (await recover(row.id)).json()).toMatchObject({
    status: 'blocked',
    reason: 'policy_denied',
  })
  expect((await request(`/${row.id}/download`)).status).toBe(404)
  expect(results.readCaptured(env.db, row.id)).toEqual(png)
  expect(await (await discard(row.id)).json()).toEqual({ resultId: row.id, discarded: true })
  const inventory = await (await request(`/private-images?teamId=${env.teamId}`)).json()
  expect(inventory).toMatchObject({ total: 0, retainedBytes: 0 })
  expect(results.getReceipt(env.db, row.id)).toMatchObject({
    releasedAt: null,
    deletedAt: expect.any(Number),
  })
  expect((await recover(row.id)).status).toBe(404)
  expect((await discard(row.id)).status).toBe(404)
  expect(
    env.db.raw.query<{ outcome: string }, []>('SELECT outcome FROM image_generations').get()
      ?.outcome,
  ).toBe('completed')
})

test('approval-required recovery reuses one reference-only hold and existing dispatcher releases it', async () => {
  const row = capture()
  edge('approval_required')
  const result = await heldRecovery(row.id)
  expect(await (await recover(row.id)).json()).toEqual(result)
  expect(approvalCount()).toBe(1)
  const held = env.db.raw
    .query<{ payload_kind: string; payload_json: string }, []>(
      'SELECT payload_kind, payload_json FROM communication_approvals',
    )
    .get()
  expect(held?.payload_kind).toBe('agent_result')
  expect(JSON.parse(held?.payload_json ?? '{}')).toEqual({ agentId, resultId: row.id })
  expect((await discard(row.id)).status).toBe(409)
  const approved = await createApp().request(`/api/approvals/${result.approvalId}/approve`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })
  expect(approved.status).toBe(200)
  expect(results.readReleased(env.db, row.id)).toEqual(png)
})

test.each([
  'denied',
  'cancelled',
  'expired',
  'delivery_failed',
  'delivered',
] as const)('recovery cannot reopen terminal approval %s, but owner may discard remaining private bytes', async (status) => {
  const row = capture()
  edge('approval_required')
  const held = await heldRecovery(row.id)
  if (status === 'expired')
    env.db.raw.run('UPDATE communication_approvals SET expires_at = 0 WHERE id = ?', [
      held.approvalId,
    ])
  else
    env.db.raw.run('UPDATE communication_approvals SET status = ? WHERE id = ?', [
      status,
      held.approvalId,
    ])
  edge('allow')
  expect(await (await recover(row.id)).json()).toMatchObject({
    status: 'blocked',
    reason: 'delivery_closed',
    approvalStatus: status,
  })
  expect(results.getReceipt(env.db, row.id)?.releasedAt).toBeNull()
  expect(approvalCount()).toBe(1)
  expect((await discard(row.id)).status).toBe(200)
  expect(
    env.db.raw
      .query<{ status: string }, [string]>(
        'SELECT status FROM communication_approvals WHERE id = ?',
      )
      .get(held.approvalId)?.status,
  ).toBe(status)
})

test.each([
  'approved',
  'delivering',
] as const)('live %s dispatch blocks recovery and discard', async (status) => {
  const row = capture()
  edge('approval_required')
  const held = await heldRecovery(row.id)
  env.db.raw.run('UPDATE communication_approvals SET status = ? WHERE id = ?', [
    status,
    held.approvalId,
  ])
  expect(await (await recover(row.id)).json()).toMatchObject({
    status: 'blocked',
    reason: 'delivery_pending',
    approvalStatus: status,
  })
  expect((await discard(row.id)).status).toBe(409)
  expect(results.readCaptured(env.db, row.id)).toEqual(png)
})

test('an existing HTTP delivery hold cannot be rerouted or duplicated by image recovery', async () => {
  const row = capture()
  edge('approval_required')
  let approvalId: string | undefined
  try {
    authorizeHttpChatFrame(env.db, agentId, 'original-http', 0, {
      kind: 'event',
      event: {
        type: 'file',
        name: row.name,
        mimeType: row.mimeType,
        data: png.toString('base64'),
        result: { resultId: row.id },
      },
    })
  } catch (error) {
    if (!(error instanceof CommunicationPendingError)) throw error
    approvalId = error.approval.id
  }
  if (!approvalId) throw new Error('Expected original HTTP hold')
  expect(await (await recover(row.id)).json()).toMatchObject({
    status: 'blocked',
    reason: 'delivery_pending',
    approvalStatus: 'pending',
  })
  expect(approvalCount()).toBe(1)
  expect((await discard(row.id)).status).toBe(409)
  expect(results.getReceipt(env.db, row.id)?.releasedAt).toBeNull()
})

test('active producers block operator recovery and discard until settlement', async () => {
  const row = capture()
  registerAgent(agentId, new AbortController())
  expect(await (await recover(row.id)).json()).toMatchObject({
    status: 'blocked',
    reason: 'producer_active',
  })
  expect((await discard(row.id)).status).toBe(409)
  unregisterAgent(agentId)
  expect((await discard(row.id)).status).toBe(200)
})

test.each([
  'archived',
  'missing',
  'transferred',
] as const)('ineligible %s producer is never replaced; original-Team owner may discard', async (state) => {
  const row = capture()
  const other = registerTeam(env.db, { id: 'other' }, env.paths)
  if (state === 'archived')
    env.db.raw.run("UPDATE agents SET status = 'archived' WHERE id = ?", [agentId])
  else if (state === 'missing') env.db.raw.run('DELETE FROM agents WHERE id = ?', [agentId])
  else env.db.raw.run('UPDATE agents SET team_id = ? WHERE id = ?', [other.id, agentId])
  expect(await (await recover(row.id)).json()).toMatchObject({
    status: 'blocked',
    reason: 'producer_unavailable',
  })
  expect((await request(`/private-images/${row.id}/recover`, { teamId: other.id })).status).toBe(
    404,
  )
  expect(results.getReceipt(env.db, row.id)?.releasedAt).toBeNull()
  expect(approvalCount()).toBe(0)
  expect((await discard(row.id)).status).toBe(200)
})

test('ordinary, forged-metadata and uncertain captures cannot use private image controls', async () => {
  const row = capture()
  env.db.raw.run("UPDATE image_generations SET outcome = 'uncertain'")
  const ordinary = results.publish(env.db, {
    agentId,
    teamId: env.teamId,
    sessionId: 'ordinary-session',
    toolCallId: 'ordinary',
    name: 'ordinary.txt',
    mimeType: 'text/plain',
    bytes: png,
  })
  const forged = results.publish(env.db, {
    agentId,
    teamId: env.teamId,
    sessionId: 'ordinary-session',
    toolCallId: 'forged',
    name: 'forged.png',
    mimeType: 'image/png',
    imageModel: 'openai:gpt-image-2',
    bytes: png,
  })
  // Keep these rows alive so refusal proves route qualification, not prior garbage collection.
  registerAgent(agentId, new AbortController())
  for (const candidate of [row, ordinary, forged]) {
    expect((await recover(candidate.id)).status).toBe(404)
    expect((await discard(candidate.id)).status).toBe(404)
    expect(results.readCaptured(env.db, candidate.id)).toEqual(png)
  }
  expect((await inventory(`teamId=${env.teamId}`)).total).toBe(0)
})

test('browser recovery and discard retain the existing session-bound CSRF requirement', async () => {
  const row = capture()
  const credential = webTokens.create(env.db, 'browser').token
  const app = createApp()
  const login = await app.request('http://127.0.0.1:4321/api/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'http://127.0.0.1:4321',
    },
    body: new URLSearchParams({ token: credential }),
  })
  expect(login.status).toBe(302)
  const cookies = login.headers.getSetCookie().map((value) => value.split(';')[0] ?? '')
  const csrf = cookies.find((value) => value.includes('csrf'))?.split('=')[1]
  if (!csrf) throw new Error('Missing browser CSRF fixture')
  for (const action of ['recover', 'discard']) {
    const response = await app.request(
      `http://127.0.0.1:4321/api/results/private-images/${row.id}/${action}`,
      {
        method: 'POST',
        headers: {
          cookie: cookies.join('; '),
          origin: 'http://127.0.0.1:4321',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          teamId: env.teamId,
          ...(action === 'discard' ? { confirm: true } : {}),
        }),
      },
    )
    expect(response.status).toBe(403)
  }
  expect(results.getReceipt(env.db, row.id)?.releasedAt).toBeNull()
  expect(
    (
      await app.request(`http://127.0.0.1:4321/api/results/private-images/${row.id}/recover`, {
        method: 'POST',
        headers: {
          cookie: cookies.join('; '),
          origin: 'http://127.0.0.1:4321',
          'content-type': 'application/json',
          'x-bazilion-csrf': csrf,
        },
        body: JSON.stringify({ teamId: env.teamId }),
      })
    ).status,
  ).toBe(200)
})

test('corrupt retained bytes never become released by recovery', async () => {
  const row = capture()
  env.db.raw.run('UPDATE agent_results SET bytes = ? WHERE id = ?', [
    Buffer.alloc(png.length),
    row.id,
  ])
  expect((await recover(row.id)).status).toBe(500)
  expect(results.getReceipt(env.db, row.id)?.releasedAt).toBeNull()
})
