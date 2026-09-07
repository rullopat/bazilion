import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatFrame } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { resolveAgent } from '../../src/core/agent/resolve.ts'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as agentRepo from '../../src/core/repos/agents.ts'
import * as results from '../../src/core/repos/results.ts'
import { registerAgent, unregisterAgent } from '../../src/lib/agent-cancel.ts'
import { authorizeHttpChatFrame, CommunicationPendingError } from '../../src/lib/communication.ts'
import { createResultHost } from '../../src/lib/result-host.ts'
import { authorizeBackgroundResult } from '../../src/lib/result-library-delivery.ts'
import {
  reconcilePrivateResults,
  recoverInterruptedResultDeliveries,
} from '../../src/lib/result-retention.ts'
import {
  _resetMirrorDepsForTest,
  installMirrorDepsResolver,
  type MirrorApi,
  mirrorAgentTurnFrame,
} from '../../src/lib/telegram/mirror.ts'
import { _resetOutboundQueueForTest } from '../../src/lib/telegram/outbound-queue.ts'
import { approvalsRouter } from '../../src/routes/approvals.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
let agentId: string
let sessionId: string
let activeHost: ReturnType<typeof createResultHost>
vi.mock('../../src/lib/ctx.ts', () => ({
  getCtx: () => ({ db: env.db, paths: env.paths, authToken: 'test-only' }),
}))
beforeEach(() => {
  env = makeTestEnv()
  vi.stubEnv('BAZILION_TEAM_POLICY_ENFORCEMENT', 'on')
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
  sessionId = randomUUID()
  activeHost = createResultHost(
    env.db,
    env.paths,
    resolveAgent(env.db, env.paths, agentId),
    new AbortController().signal,
  )
  writeFileSync(
    join(env.paths.agentDir(agentId), 'sessions', 'current.jsonl'),
    `${[
      { type: 'session', id: sessionId },
      {
        type: 'message',
        message: {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'call', name: 'deliver_file' }],
        },
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n')}\n`,
  )
})
afterEach(() => {
  vi.unstubAllEnvs()
  env.cleanup()
})
function host(signal?: AbortSignal) {
  return signal
    ? createResultHost(env.db, env.paths, resolveAgent(env.db, env.paths, agentId), signal)
    : activeHost
}
function input() {
  return {
    sessionId,
    toolCallId: 'call',
    name: 'report.txt',
    mimeType: 'text/plain',
    data: Buffer.from('captured').toString('base64'),
  }
}
async function frame(): Promise<ChatFrame> {
  const result = await host().publish(input())
  return { kind: 'event', event: { type: 'file', ...input(), result } }
}
function held(frame: ChatFrame) {
  env.db.raw.run(
    "UPDATE team_policy_edges SET posture = 'approval_required' WHERE team_id = ? AND source_kind = 'agent' AND source_id = ? AND target_kind = 'user'",
    [env.teamId, agentId],
  )
  try {
    authorizeHttpChatFrame(env.db, agentId, 'request', 0, frame)
  } catch (error) {
    if (error instanceof CommunicationPendingError) return error.approval.id
    throw error
  }
  throw new Error('Expected held delivery')
}

test('publication validates canonical session/call identity and rejects cancelled or oversized requests', async () => {
  await expect(host().publish({ ...input(), sessionId: randomUUID() })).rejects.toThrow('session')
  await expect(host().publish({ ...input(), toolCallId: 'other' })).rejects.toThrow('tool call')
  await expect(host().publish({ ...input(), data: '!!!!' })).rejects.toThrow('bytes')
  await expect(host(AbortSignal.abort()).publish(input())).rejects.toThrow()
  const result = await host().publish(input())
  expect(results.getReceipt(env.db, result.resultId)).toMatchObject({
    agentId,
    teamId: env.teamId,
    sessionId,
    toolCallId: 'call',
  })
  expect(results.getReleased(env.db, result.resultId)).toBeNull()
})

test('allowed HTTP delivery releases the captured bytes, not forged event data', async () => {
  const event = await frame()
  if (event.kind !== 'event' || event.event.type !== 'file') throw new Error('fixture')
  event.event.data = Buffer.from('changed event').toString('base64')
  authorizeHttpChatFrame(env.db, agentId, 'request', 0, event)
  expect(Buffer.from(event.event.data, 'base64').toString()).toBe('captured')
  expect(results.listReleased(env.db).total).toBe(1)
})

test('held HTTP delivery stores no bytes in approval detail and canonical approval releases its snapshot', async () => {
  const event = await frame()
  const id = held(event)
  expect(results.listReleased(env.db).total).toBe(0)
  const detail = await approvalsRouter.request(`/${id}`)
  const body = await detail.json()
  expect(body).toMatchObject({
    file: { name: 'report.txt', mimeType: 'text/plain', byteLength: 8 },
  })
  expect(JSON.stringify(body)).not.toContain(input().data)
  const response = await approvalsRouter.request(`/${id}/approve`, { method: 'POST' })
  expect(response.status).toBe(200)
  const [result] = results.listReleased(env.db).results
  if (!result) throw new Error('Approved result was not released')
  expect(results.readReleased(env.db, result.id).toString()).toBe('captured')
  expect((await approvalsRouter.request(`/${id}/approve`, { method: 'POST' })).status).not.toBe(200)
})

test('revoked policy cannot release a held snapshot', async () => {
  const id = held(await frame())
  env.db.raw.run(
    "DELETE FROM team_policy_edges WHERE team_id = ? AND source_kind = 'agent' AND target_kind = 'user'",
    [env.teamId],
  )
  expect((await approvalsRouter.request(`/${id}/approve`, { method: 'POST' })).status).toBe(409)
  expect(results.listReleased(env.db).total).toBe(0)
})

test('background deliverables use canonical egress and an executable reference-only approval', async () => {
  const event = await frame()
  env.db.raw.run(
    "UPDATE team_policy_edges SET posture = 'approval_required' WHERE team_id = ? AND source_kind = 'agent' AND source_id = ? AND target_kind = 'user'",
    [env.teamId, agentId],
  )
  authorizeBackgroundResult(env.db, agentId, event)
  const approval = env.db.raw
    .query<{ id: string; payload_json: string }, []>(
      "SELECT id, payload_json FROM communication_approvals WHERE payload_kind = 'agent_result'",
    )
    .get()
  expect(approval).toBeTruthy()
  expect(approval?.payload_json).not.toContain(input().data)
  expect(await (await approvalsRouter.request(`/${approval?.id}`)).json()).toMatchObject({
    file: { name: 'report.txt', mimeType: 'text/plain', byteLength: 8 },
  })
  expect(reconcilePrivateResults(env.db)).toBe(0)
  expect(results.listReleased(env.db).total).toBe(0)
  expect(
    (await approvalsRouter.request(`/${approval?.id}/approve`, { method: 'POST' })).status,
  ).toBe(200)
  const result = results.listReleased(env.db).results[0]
  if (!result) throw new Error('Expected released result')
  expect(results.readReleased(env.db, result.id).toString()).toBe('captured')
  expect(reconcilePrivateResults(env.db)).toBe(0)
})

test('missing background egress cannot publish into the library', async () => {
  const event = await frame()
  env.db.raw.run(
    "DELETE FROM team_policy_edges WHERE team_id = ? AND source_kind = 'agent' AND target_kind = 'user'",
    [env.teamId],
  )
  authorizeBackgroundResult(env.db, agentId, event)
  expect(results.listReleased(env.db).total).toBe(0)
  expect(reconcilePrivateResults(env.db)).toBe(1)
  await expect(host().publish(input())).rejects.toThrow('deleted')
})

test.each([
  'deny',
  'cancel',
  'expire',
] as const)('private bytes are reclaimed after %s without releasing the receipt', async (decision) => {
  const event = await frame()
  const id = held(event)
  if (decision === 'expire') {
    env.db.raw.run('UPDATE communication_approvals SET expires_at = 0 WHERE id = ?', [id])
    expect(reconcilePrivateResults(env.db)).toBe(1)
  } else {
    expect((await approvalsRouter.request(`/${id}/${decision}`, { method: 'POST' })).status).toBe(
      200,
    )
  }
  if (event.kind !== 'event' || event.event.type !== 'file') throw new Error('fixture')
  const reference = event.event.result
  if (!reference) throw new Error('Expected result reference')
  expect(results.getReceipt(env.db, reference.resultId)?.deletedAt).not.toBeNull()
  expect(results.getReleased(env.db, reference.resultId)).toBeNull()
  expect(() => results.readCaptured(env.db, reference.resultId)).toThrow('unavailable')
})

test('active producers retain unreferenced bytes until settlement; orphaned publication cannot resurrect', async () => {
  const result = await host().publish(input())
  registerAgent(agentId, new AbortController())
  try {
    expect(reconcilePrivateResults(env.db)).toBe(0)
  } finally {
    unregisterAgent(agentId)
  }
  expect(reconcilePrivateResults(env.db)).toBe(1)
  expect(results.getReceipt(env.db, result.resultId)?.deletedAt).not.toBeNull()
  await expect(host().publish(input())).rejects.toThrow('deleted')
})

test('restart marks interrupted result dispatch uncertain and reclaims only unreleased snapshots', async () => {
  const event = await frame()
  const id = held(event)
  env.db.raw.run("UPDATE communication_approvals SET status = 'delivering' WHERE id = ?", [id])
  expect(reconcilePrivateResults(env.db)).toBe(0)
  recoverInterruptedResultDeliveries(env.db)
  expect(reconcilePrivateResults(env.db)).toBe(1)
  const response = await approvalsRouter.request(`/${id}`)
  expect(await response.json()).toMatchObject({ status: 'delivery_failed' })
})

test('Telegram uses captured bytes and keeps the result after a failed document send', async () => {
  const event = await frame()
  agentRepo.setTelegramTopicId(env.db, agentId, 42)
  let captured = ''
  const api: MirrorApi = {
    sendMessage: vi.fn(),
    sendChatAction: vi.fn(),
    sendPhoto: vi.fn(),
    async sendDocument(_chat, file) {
      const raw = await file.toRaw()
      if (!(raw instanceof Uint8Array)) throw new Error('Expected captured buffer')
      captured = Buffer.from(raw).toString()
      throw new Error('transport unavailable')
    },
  }
  installMirrorDepsResolver(() => ({ db: env.db, api, chatId: -100123 }))
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    if (event.kind !== 'event' || event.event.type !== 'file') throw new Error('fixture')
    event.event.data = Buffer.from('changed source').toString('base64')
    await mirrorAgentTurnFrame(agentId, event, 'telegram-result')
    expect(captured).toBe('captured')
    expect(results.listReleased(env.db).total).toBe(1)
    expect(reconcilePrivateResults(env.db)).toBe(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('telegram_mirror_file_failed'))
  } finally {
    warn.mockRestore()
    _resetMirrorDepsForTest()
    _resetOutboundQueueForTest()
  }
})

test('held Telegram document retains only its reference and approval failure keeps authorized bytes', async () => {
  const event = await frame()
  agentRepo.setTelegramTopicId(env.db, agentId, 42)
  env.db.raw.run(
    "UPDATE team_policy_edges SET posture = 'approval_required' WHERE team_id = ? AND source_kind = 'agent' AND source_id = ? AND target_kind = 'user'",
    [env.teamId, agentId],
  )
  const api: MirrorApi = {
    sendMessage: vi.fn(),
    sendChatAction: vi.fn(),
    sendPhoto: vi.fn(),
    sendDocument: vi.fn(),
  }
  installMirrorDepsResolver(() => ({ db: env.db, api, chatId: -100123 }))
  try {
    await mirrorAgentTurnFrame(agentId, event, 'telegram-held-result')
    expect(api.sendDocument).not.toHaveBeenCalled()
    expect(results.listReleased(env.db).total).toBe(0)
    expect(reconcilePrivateResults(env.db)).toBe(0)
    const approval = env.db.raw
      .query<{ id: string; payload_json: string }, []>(
        "SELECT id,payload_json FROM communication_approvals WHERE payload_kind = 'telegram_file'",
      )
      .get()
    if (!approval) throw new Error('Expected held document')
    expect(approval.payload_json).not.toContain(input().data)
    expect(await (await approvalsRouter.request(`/${approval.id}`)).json()).toMatchObject({
      file: { name: 'report.txt', mimeType: 'text/plain', byteLength: 8 },
    })
    // No Telegram credential in this fixture. Authorization succeeds, transport truthfully fails.
    const response = await approvalsRouter.request(`/${approval.id}/approve`, { method: 'POST' })
    expect(response.status).toBe(500)
    expect(await (await approvalsRouter.request(`/${approval.id}`)).json()).toMatchObject({
      status: 'delivery_failed',
    })
    expect(results.listReleased(env.db).total).toBe(1)
    expect(reconcilePrivateResults(env.db)).toBe(0)
  } finally {
    _resetMirrorDepsForTest()
    _resetOutboundQueueForTest()
  }
})

test('a newly started turn cannot publish against a tool call from its existing history', async () => {
  const laterHost = createResultHost(
    env.db,
    env.paths,
    resolveAgent(env.db, env.paths, agentId),
    new AbortController().signal,
  )
  await expect(laterHost.publish(input())).rejects.toThrow('not in this turn')
  expect(results.listReleased(env.db).total).toBe(0)
})

test('allowed background publication releases exactly one captured library result', async () => {
  const event = await frame()
  authorizeBackgroundResult(env.db, agentId, event)
  authorizeBackgroundResult(env.db, agentId, event)
  expect(results.listReleased(env.db).total).toBe(1)
})

test('approval file metadata rejects a receipt owned by another producer', async () => {
  const id = held(await frame())
  const other = spawnAgent(env.db, env.paths, { profileId: 'producer', teamId: env.teamId })
  env.db.raw.run('UPDATE agent_results SET agent_id = ?', [other.id])
  const detail = await (await approvalsRouter.request(`/${id}`)).json()
  expect(detail).not.toHaveProperty('file')
  expect(results.listReleased(env.db).total).toBe(0)
})
