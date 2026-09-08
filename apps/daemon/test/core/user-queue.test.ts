import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { openDb } from '../../src/core/db/client.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as queue from '../../src/core/repos/user-queue.ts'
import { authorizeUserIngress, CommunicationPendingError } from '../../src/lib/communication.ts'
import { resolveConversationTarget } from '../../src/lib/conversation-target.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

let env: TestEnv
let agentId: string
let conversationId: string
beforeEach(() => {
  env = makeTestEnv()
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
  conversationId = resolveConversationTarget(env.db, env.paths, agentId).id
})
afterEach(() => env.cleanup())
function input(overrides: Partial<queue.QueueInput> = {}): queue.QueueInput {
  const id = randomUUID()
  return {
    id,
    agentId,
    teamId: env.teamId,
    conversationId,
    source: 'http',
    attemptId: id,
    provenance: { expectedSelection: { conversationId, revision: 1 } },
    message: 'Use this exact input',
    attachments: [
      {
        name: 'notes.txt',
        mimeType: 'text/plain',
        data: Buffer.from('captured bytes').toString('base64'),
      },
    ],
    ...overrides,
  }
}

test('acceptance retains exact bytes and identical retries reconcile without a second position', () => {
  const request = input()
  const first = queue.accept(env.db, request)
  expect(first).toMatchObject({
    status: 'pending',
    position: 1,
    revision: 1,
    conversationId,
    text: request.message,
  })
  expect(queue.accept(env.db, request).id).toBe(first.id)
  expect(queue.list(env.db, agentId).total).toBe(1)
  expect(queue.readInput(env.db, agentId, first.id).attachments).toEqual(request.attachments)
  expect(() => queue.accept(env.db, { ...request, message: 'different' })).toThrow(
    queue.QueueConflictError,
  )
  expect(queue.get(env.db, randomUUID(), first.id)).toBeNull()
  expect(queue.accept(env.db, input()).position).toBe(2)
})

test('attachment persistence failure rolls back item, bytes and position together', () => {
  env.db.raw.exec(
    "CREATE TRIGGER reject_queue_attachment BEFORE INSERT ON user_queue_attachments BEGIN SELECT RAISE(ABORT, 'disk simulation'); END",
  )
  expect(() => queue.accept(env.db, input())).toThrow('disk simulation')
  expect(queue.list(env.db, agentId).total).toBe(0)
  env.db.raw.exec('DROP TRIGGER reject_queue_attachment')
  expect(queue.accept(env.db, input()).position).toBe(1)
})

test('missing or corrupt attachment content fails instead of becoming a text-only turn', () => {
  const first = queue.accept(env.db, input())
  env.db.raw.run('UPDATE user_queue_attachments SET bytes = ? WHERE item_id = ?', [
    Buffer.from('corruption'),
    first.id,
  ])
  expect(() => queue.readInput(env.db, agentId, first.id)).toThrow(/corrupt/)
  const second = queue.accept(env.db, input())
  env.db.raw.run('DELETE FROM user_queue_attachments WHERE item_id = ?', [second.id])
  expect(() => queue.readInput(env.db, agentId, second.id)).toThrow(/missing or corrupt/)
})

test('an edit replaces the original attempt at its position and claim wins against a stale editor', () => {
  const original = queue.accept(env.db, input({ source: 'telegram', attemptId: '-100:7' }))
  const next = queue.accept(env.db, input())
  const replacementInput = input({ message: 'Authenticated correction' })
  const replacement = queue.accept(env.db, replacementInput, {
    id: original.id,
    expectedRevision: 1,
  })
  expect(replacement).toMatchObject({ position: 1, source: 'http', supersedesId: original.id })
  expect(queue.get(env.db, agentId, original.id)?.status).toBe('superseded')
  expect(queue.accept(env.db, replacementInput, { id: original.id, expectedRevision: 1 }).id).toBe(
    replacement.id,
  )
  expect(queue.claim(env.db, agentId)?.id).toBe(replacement.id)
  expect(() => queue.accept(env.db, input(), { id: replacement.id, expectedRevision: 1 })).toThrow(
    queue.QueueConflictError,
  )
  expect(() => queue.remove(env.db, agentId, replacement.id, 1)).toThrow(queue.QueueConflictError)
  expect(queue.claim(env.db, agentId)).toBeNull()
  queue.transition(env.db, agentId, replacement.id, 'claimed', 'running')
  queue.transition(env.db, agentId, replacement.id, 'running', 'completed')
  expect(queue.claim(env.db, agentId)?.id).toBe(next.id)
})

test('pause prevents claim, deletion wins before claim, and stale controls conflict', () => {
  const first = queue.accept(env.db, input())
  queue.setPaused(env.db, agentId, true, 0)
  expect(queue.claim(env.db, agentId)).toBeNull()
  expect(() => queue.setPaused(env.db, agentId, false, 0)).toThrow(queue.QueueConflictError)
  queue.remove(env.db, agentId, first.id, 1)
  queue.setPaused(env.db, agentId, false, 1)
  expect(queue.claim(env.db, agentId)).toBeNull()
})

test('restart marks a claim uncertain, pauses later work and never replays that claim', () => {
  const first = queue.accept(env.db, input())
  const next = queue.accept(env.db, input())
  queue.claim(env.db, agentId)
  expect(queue.recoverInterrupted(env.db)).toBe(1)
  expect(queue.get(env.db, agentId, first.id)?.status).toBe('uncertain')
  expect(queue.control(env.db, agentId)).toMatchObject({ paused: true, reason: 'interrupted' })
  expect(queue.claim(env.db, agentId)).toBeNull()
  expect(() =>
    queue.setPaused(env.db, agentId, false, queue.control(env.db, agentId).revision),
  ).toThrow(/uncertain/)
  expect(queue.recoverInterrupted(env.db)).toBe(0)
  queue.transition(env.db, agentId, first.id, 'uncertain', 'cancelled')
  queue.setPaused(env.db, agentId, false, queue.control(env.db, agentId).revision)
  expect(queue.claim(env.db, agentId)?.id).toBe(next.id)
})

test('bounded acceptance rejects malformed bytes and capacity without dropping existing work', () => {
  expect(() =>
    queue.accept(env.db, input({ attachments: [{ mimeType: 'text/plain', data: '!!!!' }] })),
  ).toThrow(/bytes/)
  expect(() =>
    queue.accept(env.db, input({ message: 'x'.repeat(queue.QUEUE_LIMITS.textBytes + 1) })),
  ).toThrow(/text/)
  expect(() =>
    queue.accept(
      env.db,
      input({
        attachments: Array.from({ length: 17 }, () => ({ mimeType: 'text/plain', data: '' })),
      }),
    ),
  ).toThrow(/attachments/)
  for (let i = 0; i < queue.QUEUE_LIMITS.perAgent; i++)
    queue.accept(env.db, input({ attachments: [] }))
  expect(() => queue.accept(env.db, input())).toThrow(queue.QueueCapacityError)
  expect(queue.list(env.db, agentId).total).toBe(queue.QUEUE_LIMITS.perAgent)
})

test('terminal pruning retains idempotency receipts and never prunes unresolved uncertainty', () => {
  const request = input()
  const first = queue.accept(env.db, request)
  queue.claim(env.db, agentId)
  queue.transition(env.db, agentId, first.id, 'claimed', 'running')
  queue.transition(env.db, agentId, first.id, 'running', 'completed')
  const second = queue.accept(env.db, input())
  queue.claim(env.db, agentId)
  queue.recoverInterrupted(env.db)
  expect(queue.pruneTerminalInput(env.db, Date.now() + queue.QUEUE_LIMITS.terminalMs + 1)).toBe(1)
  expect(queue.accept(env.db, request)).toMatchObject({
    id: first.id,
    status: 'completed',
    payloadRetained: false,
    text: null,
  })
  expect(queue.get(env.db, agentId, second.id)?.payloadRetained).toBe(true)
  expect(() => queue.readInput(env.db, agentId, first.id)).toThrow(/no longer retained/)
})

test('an approval-held FIFO head cannot be edited, removed, or bypassed', () => {
  const previous = process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
  process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
  try {
    const first = queue.accept(env.db, input())
    queue.accept(env.db, input())
    env.db.raw.run(
      "UPDATE team_policy_edges SET posture = 'approval_required' WHERE team_id = ? AND source_kind = 'user' AND target_id = ?",
      [env.teamId, agentId],
    )
    let approvalId: string | undefined
    try {
      authorizeUserIngress(env.db, agentId, {
        origin: 'http_chat',
        attemptKind: 'http_chat_ingress',
        attemptId: first.attemptId,
        approvalPayloadKind: 'queued_user',
        approvalPayload: { itemId: first.id },
      })
    } catch (error) {
      if (error instanceof CommunicationPendingError) approvalId = error.approval.id
      else throw error
    }
    expect(approvalId).toBeDefined()
    queue.transition(env.db, agentId, first.id, 'pending', 'held', { approvalId })
    expect(queue.claim(env.db, agentId)).toBeNull()
    expect(() => queue.remove(env.db, agentId, first.id, 2)).toThrow(queue.QueueConflictError)
    expect(() => queue.accept(env.db, input(), { id: first.id, expectedRevision: 2 })).toThrow(
      queue.QueueConflictError,
    )
  } finally {
    if (previous === undefined) delete process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
    else process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = previous
  }
})

test('database reopen preserves pending bytes, claim uncertainty and saved pause', () => {
  const original = queue.accept(env.db, input())
  const pending = queue.accept(env.db, input())
  queue.claim(env.db, agentId)
  const file = join(env.home, 'queue-restart.db')
  env.db.raw.run('VACUUM INTO ?', [file])
  let reopened = openDb(file)
  try {
    expect(queue.recoverInterrupted(reopened)).toBe(1)
    expect(queue.get(reopened, agentId, original.id)?.status).toBe('uncertain')
    expect(queue.readInput(reopened, agentId, pending.id).attachments[0]?.data).toBe(
      Buffer.from('captured bytes').toString('base64'),
    )
  } finally {
    reopened.close()
  }
  reopened = openDb(file)
  try {
    expect(queue.control(reopened, agentId).paused).toBe(true)
    expect(queue.claim(reopened, agentId)).toBeNull()
    expect(queue.recoverInterrupted(reopened)).toBe(0)
    expect(queue.findAttempt(reopened, 'http', original.attemptId)?.id).toBe(original.id)
    expect(queue.agentsWithOpenItems(reopened)).toEqual([agentId])
  } finally {
    reopened.close()
  }
})
