import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as approvals from '../../src/core/repos/communicationApprovals.ts'
import * as conversations from '../../src/core/repos/conversations.ts'
import * as queue from '../../src/core/repos/user-queue.ts'
import { registerAgent, unregisterAgent } from '../../src/lib/agent-cancel.ts'
import { validateQueuedUserApproval } from '../../src/lib/approval-delivery-plan.ts'
import { createConversationFile } from '../../src/lib/conversation-file.ts'
import { enqueueHttpInput } from '../../src/lib/user-queue-admission.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
let agentId: string
vi.mock('../../src/lib/ctx.ts', () => ({
  getCtx: () => ({ db: env.db, paths: env.paths, authToken: 'test' }),
}))
beforeEach(() => {
  env = makeTestEnv()
  vi.stubEnv('BAZILION_TEAM_POLICY_ENFORCEMENT', 'on')
  createProfile(env.db, env.paths, {
    id: 'queue',
    defaultModel: 'lmstudio:test',
    communicationDefaults: {
      userInput: true,
      userOutput: true,
      outsideTeamInput: false,
      outsideTeamOutput: false,
      peerDefault: 'allow_all',
    },
  })
  agentId = spawnAgent(env.db, env.paths, { profileId: 'queue', teamId: env.teamId }).id
})
afterEach(() => {
  unregisterAgent(agentId)
  vi.unstubAllEnvs()
  env.cleanup()
})
const request = () => ({
  requestId: randomUUID(),
  expectedSelection: conversations.selection(env.db, agentId),
  message: 'Keep this follow-up',
  attachments: [{ name: 'a.txt', mimeType: 'text/plain', data: 'eA==' }],
})

test('busy admission retains input without disturbing the active Agent registration', async () => {
  const controller = new AbortController()
  registerAgent(agentId, controller)
  const input = request()
  const item = await enqueueHttpInput(agentId, input)
  expect(item.status).toBe('pending')
  expect(controller.signal.aborted).toBe(false)
  expect(queue.readInput(env.db, agentId, item.id).attachments).toEqual(input.attachments)
  expect((await enqueueHttpInput(agentId, input)).id).toBe(item.id)
})

test('a held queue input and its reference-only canonical approval commit together', async () => {
  env.db.raw.run(
    "UPDATE team_policy_edges SET posture = 'approval_required' WHERE team_id = ? AND source_kind = 'user' AND target_id = ?",
    [env.teamId, agentId],
  )
  const input = request()
  const item = await enqueueHttpInput(agentId, input)
  expect(item.status).toBe('held')
  const approval = approvals.get(env.db, item.approvalId!, true)
  expect(approval).toMatchObject({
    payloadKind: 'queued_user',
    attemptId: input.requestId,
    status: 'pending',
    payload: { agentId, itemId: item.id, inputDigest: expect.any(String) },
  })
  expect(JSON.stringify(approval)).not.toContain('Keep this follow-up')
  expect(JSON.stringify(approval)).not.toContain('eA==')
  expect((await enqueueHttpInput(agentId, input)).approvalId).toBe(item.approvalId)
  expect(queue.claim(env.db, agentId)).toBeNull()
})

test('approval reference rejects substituted input, ownership and transport without reading bytes', async () => {
  env.db.raw.run(
    "UPDATE team_policy_edges SET posture = 'approval_required' WHERE team_id = ? AND source_kind = 'user' AND target_id = ?",
    [env.teamId, agentId],
  )
  const item = await enqueueHttpInput(agentId, request())
  if (!item.approvalId) throw new Error('Expected hold')
  const approval = approvals.get(env.db, item.approvalId, true)
  if (!approval || !('payload' in approval)) throw new Error('Expected approval detail')
  const reference = queue.approvalReference(env.db, agentId, item.id)
  const lookup = (owner: string, id: string) => {
    const found = queue.get(env.db, owner, id)
    return found ? { item: found, inputDigest: reference.inputDigest } : null
  }
  expect(validateQueuedUserApproval(approval, lookup)).toEqual(reference)
  for (const changed of [
    { payload: { ...reference, inputDigest: '0'.repeat(64) } },
    { payload: { ...reference, itemId: randomUUID() } },
    { payload: { ...reference, agentId: 'another-agent' } },
    { payload: { ...reference, message: 'substitute bytes' } },
    { id: 'another-approval' },
    { attemptId: randomUUID() },
    { sourceTeamId: 'another-team' },
    { origin: 'telegram_agent_topic' as const },
    { attemptKind: 'telegram_ingress' },
    { payloadKind: 'agent_turn' },
  ]) {
    expect(() => validateQueuedUserApproval({ ...approval, ...changed }, lookup)).toThrow(
      'approval_delivery_invalid',
    )
  }
  expect(() =>
    validateQueuedUserApproval(approval, () => ({
      item: { ...item, teamId: 'another-team' },
      inputDigest: reference.inputDigest,
    })),
  ).toThrow('queued_user_binding')
  // Detail validation is metadata-only, including after terminal payload retention expires.
  env.db.raw.run('DELETE FROM user_queue_attachments WHERE item_id = ?', [item.id])
  expect(validateQueuedUserApproval(approval, lookup)).toEqual(reference)
  expect(() => queue.readInput(env.db, agentId, item.id)).toThrow()
})

test('policy denial rolls back the new receipt and all bytes; a stale target also rejects', async () => {
  env.db.raw.run("DELETE FROM team_policy_edges WHERE team_id = ? AND source_kind = 'user'", [
    env.teamId,
  ])
  await expect(enqueueHttpInput(agentId, request())).rejects.toThrow()
  expect(queue.list(env.db, agentId).total).toBe(0)
  expect(
    env.db.raw.query<{ n: number }, []>('SELECT count(*) n FROM team_policy_block_events').get()?.n,
  ).toBe(1)
  expect(
    env.db.raw.query<{ n: number }, []>('SELECT count(*) n FROM user_queue_attachments').get()?.n,
  ).toBe(0)
  await expect(
    enqueueHttpInput(agentId, {
      ...request(),
      expectedSelection: { conversationId: null, revision: 0 },
    }),
  ).rejects.toThrow(conversations.ConversationConflictError)
})

test('lost acknowledgement reconciles the original receipt after selection changes', async () => {
  const input = request()
  const item = await enqueueHttpInput(agentId, input)
  const next = conversations.create(
    env.db,
    agentId,
    { requestId: randomUUID(), expectedSelection: conversations.selection(env.db, agentId) },
    (id) => createConversationFile(env.paths, agentId, id, env.paths.teamDir(env.teamId)),
  )
  expect((await enqueueHttpInput(agentId, input)).id).toBe(item.id)
  expect(conversations.selection(env.db, agentId)).toEqual(next.selection)
  await expect(enqueueHttpInput(agentId, { ...input, message: 'changed request' })).rejects.toThrow(
    queue.QueueConflictError,
  )
})

test('approval persistence failure rolls back a replacement and restores its original FIFO head', async () => {
  const original = await enqueueHttpInput(agentId, request())
  env.db.raw.run(
    "UPDATE team_policy_edges SET posture = 'approval_required' WHERE team_id = ? AND source_kind = 'user' AND target_id = ?",
    [env.teamId, agentId],
  )
  env.db.raw.exec(
    "CREATE TRIGGER reject_queue_approval BEFORE INSERT ON communication_approvals BEGIN SELECT RAISE(ABORT, 'approval persistence failure'); END",
  )
  await expect(
    enqueueHttpInput(agentId, request(), { id: original.id, expectedRevision: 1 }),
  ).rejects.toThrow('approval persistence failure')
  expect(queue.list(env.db, agentId).items).toMatchObject([
    { id: original.id, status: 'pending', revision: 1, position: 1 },
  ])
  expect(
    env.db.raw.query<{ n: number }, []>('SELECT count(*) n FROM communication_approvals').get()?.n,
  ).toBe(0)
  expect(queue.readInput(env.db, agentId, original.id).attachments).toHaveLength(1)
})

test('malformed request identity does not create or select a conversation', async () => {
  await expect(enqueueHttpInput(agentId, { ...request(), requestId: 'invalid' })).rejects.toThrow(
    'request ID',
  )
  expect(conversations.list(env.db, agentId).total).toBe(0)
  expect(queue.list(env.db, agentId).total).toBe(0)
})
