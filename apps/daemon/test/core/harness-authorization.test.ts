import { afterEach, beforeEach, expect, test } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { registerGroup } from '../../src/core/group/register.ts'
import { authorizeCommunication, recordDenial } from '../../src/core/harness/authorization.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as messageRepo from '../../src/core/repos/messages.ts'
import {
  CommunicationDeniedError,
  deliverableInbox,
  sendAgentMessage,
} from '../../src/lib/communication.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

let env: TestEnv
let oldGate: string | undefined
beforeEach(() => {
  env = makeTestEnv()
  oldGate = process.env.BAZILION_HARNESS_ENFORCEMENT
  createProfile(env.db, env.paths, { id: 'p', defaultModel: 'm' })
})
afterEach(() => {
  if (oldGate === undefined) delete process.env.BAZILION_HARNESS_ENFORCEMENT
  else process.env.BAZILION_HARNESS_ENFORCEMENT = oldGate
  env.cleanup()
})

function edge(group: string, sk: string, sid: string, tk: string, tid: string) {
  env.db.raw.run(
    'INSERT INTO live_harness_edges (group_id, source_kind, source_id, target_kind, target_id) VALUES (?, ?, ?, ?, ?)',
    [group, sk, sid, tk, tid],
  )
}

test('exact same-Group edges decide independently of origin', () => {
  const a = spawnAgent(env.db, env.paths, { profileId: 'p', groupId: env.groupId })
  const b = spawnAgent(env.db, env.paths, { profileId: 'p', groupId: env.groupId })
  env.db.raw.run('DELETE FROM live_harness_edges WHERE group_id = ?', [env.groupId])
  edge(env.groupId, 'agent', a.id, 'agent', b.id)
  const base = {
    source: { kind: 'agent' as const, id: a.id },
    target: { kind: 'agent' as const, id: b.id },
    attemptKind: 'test',
    attemptId: '1',
  }
  expect(authorizeCommunication(env.db, { ...base, origin: 'tool' })).toMatchObject({
    decision: 'allow',
    channel: 'same_group',
  })
  expect(authorizeCommunication(env.db, { ...base, origin: 'http' })).toMatchObject({
    decision: 'allow',
    channel: 'same_group',
  })
  expect(
    authorizeCommunication(env.db, {
      ...base,
      source: base.target,
      target: base.source,
      origin: 'tool',
    }),
  ).toMatchObject({ decision: 'deny', reasonCode: 'no_allow_edge' })
})

test('cross-Group decisions are two-sided and retain both policy revisions', () => {
  registerGroup(env.db, { id: 'other' }, env.paths)
  const a = spawnAgent(env.db, env.paths, { profileId: 'p', groupId: env.groupId })
  const b = spawnAgent(env.db, env.paths, { profileId: 'p', groupId: 'other' })
  env.db.raw.run('DELETE FROM live_harness_edges WHERE group_id IN (?, ?)', [env.groupId, 'other'])
  edge(env.groupId, 'agent', a.id, 'outside_group', '')
  const input = {
    source: { kind: 'agent' as const, id: a.id },
    target: { kind: 'agent' as const, id: b.id },
    origin: 'tool',
    attemptKind: 'test',
    attemptId: 'cross',
  }
  expect(authorizeCommunication(env.db, input)).toMatchObject({
    decision: 'deny',
    channel: 'cross_group',
    reasonCode: 'target_outside_input_denied',
    policyRefs: [{ groupId: env.groupId }, { groupId: 'other' }],
    componentOutcomes: [{ matched: true }, { matched: false }],
  })
  edge('other', 'outside_group', '', 'agent', b.id)
  expect(authorizeCommunication(env.db, input)).toMatchObject({
    decision: 'allow',
    componentOutcomes: [{ matched: true }, { matched: true }],
  })
})

test('boundary, lifecycle, missing policy, and invalid paths fail closed', () => {
  const a = spawnAgent(env.db, env.paths, { profileId: 'p', groupId: env.groupId })
  const userInput = {
    source: { kind: 'user' as const, groupId: env.groupId },
    target: { kind: 'agent' as const, id: a.id },
    origin: 'http',
    attemptKind: 'test',
    attemptId: 'u',
  }
  expect(authorizeCommunication(env.db, userInput).decision).toBe('allow')
  env.db.raw.run('DELETE FROM live_harness_edges WHERE group_id = ? AND source_kind = ?', [
    env.groupId,
    'user',
  ])
  expect(authorizeCommunication(env.db, userInput)).toMatchObject({
    decision: 'deny',
    reasonCode: 'no_allow_edge',
  })
  env.db.raw.run("UPDATE agents SET status = 'archived' WHERE id = ?", [a.id])
  expect(authorizeCommunication(env.db, userInput).reasonCode).toBe('agent_archived')
  expect(
    authorizeCommunication(env.db, { ...userInput, target: { kind: 'agent', id: 'missing' } })
      .reasonCode,
  ).toBe('agent_not_found')
  expect(
    authorizeCommunication(env.db, {
      ...userInput,
      source: { kind: 'user', groupId: env.groupId },
      target: { kind: 'outside_group', groupId: env.groupId },
    }).reasonCode,
  ).toBe('invalid_communication_path')
})

test('missing and corrupt Group policy have distinct stable denials', () => {
  const a = spawnAgent(env.db, env.paths, { profileId: 'p', groupId: env.groupId })
  const input = {
    source: { kind: 'user' as const, groupId: env.groupId },
    target: { kind: 'agent' as const, id: a.id },
    origin: 'test',
    attemptKind: 'test',
    attemptId: 'policy',
  }
  env.db.raw.exec('PRAGMA ignore_check_constraints = ON')
  env.db.raw.run("UPDATE live_harnesses SET membership_mode = 'broken' WHERE group_id = ?", [
    env.groupId,
  ])
  expect(authorizeCommunication(env.db, input).reasonCode).toBe('group_policy_invalid')
  env.db.raw.exec('DROP TRIGGER prevent_detached_live_harness_delete')
  env.db.raw.run('DELETE FROM live_harnesses WHERE group_id = ?', [env.groupId])
  expect(authorizeCommunication(env.db, input).reasonCode).toBe('group_policy_missing')
})

test('typed denial identity is immutable, idempotent, private, and rejects semantic collision', () => {
  const a = spawnAgent(env.db, env.paths, { profileId: 'p', groupId: env.groupId })
  const b = spawnAgent(env.db, env.paths, { profileId: 'p', groupId: env.groupId })
  env.db.raw.run('DELETE FROM live_harness_edges WHERE group_id = ?', [env.groupId])
  const input = {
    source: { kind: 'agent' as const, id: a.id },
    target: { kind: 'agent' as const, id: b.id },
    origin: 'first',
    attemptKind: 'agent_tool',
    attemptId: 'same',
  }
  const result = authorizeCommunication(env.db, input)
  recordDenial(env.db, input, 'send_agent_message', result)
  recordDenial(env.db, { ...input, origin: 'retry' }, 'send_agent_message', result)
  expect(
    env.db.raw.query<{ count: number }, []>('SELECT COUNT(*) count FROM harness_block_events').get()
      ?.count,
  ).toBe(1)
  const stored = env.db.raw
    .query<Record<string, unknown>, []>('SELECT * FROM harness_block_events')
    .get()
  expect(stored?.origin).toBe('first')
  expect(JSON.stringify(stored)).not.toContain('payload')
  expect(
    recordDenial(
      env.db,
      { ...input, target: { kind: 'agent', id: a.id } },
      'send_agent_message',
      result,
    ).reasonCode,
  ).toBe('attempt_key_conflict')
})

test('unique-insert race reloads the winner and applies its fingerprint', () => {
  const a = spawnAgent(env.db, env.paths, { profileId: 'p', groupId: env.groupId })
  const b = spawnAgent(env.db, env.paths, { profileId: 'p', groupId: env.groupId })
  env.db.raw.run('DELETE FROM live_harness_edges WHERE group_id = ?', [env.groupId])
  const input = {
    source: { kind: 'agent' as const, id: a.id },
    target: { kind: 'agent' as const, id: b.id },
    origin: 'race',
    attemptKind: 'agent_tool',
    attemptId: 'race',
  }
  const result = authorizeCommunication(env.db, input)
  const originalRun = env.db.raw.run.bind(env.db.raw)
  let simulated = false
  env.db.raw.run = (sql, params) => {
    const value = originalRun(sql, params)
    if (!simulated && sql.startsWith('INSERT INTO harness_block_events')) {
      simulated = true
      throw new Error('simulated unique race')
    }
    return value
  }
  expect(recordDenial(env.db, input, 'send_agent_message', result)).toMatchObject({
    reasonCode: 'no_allow_edge',
  })
  env.db.raw.run = originalRun
  expect(
    env.db.raw.query<{ count: number }, []>('SELECT COUNT(*) count FROM harness_block_events').get()
      ?.count,
  ).toBe(1)
})

test('gate defaults off; enabled denial is atomic and allowed replies preserve linkage', () => {
  const a = spawnAgent(env.db, env.paths, { profileId: 'p', groupId: env.groupId })
  const b = spawnAgent(env.db, env.paths, { profileId: 'p', groupId: env.groupId })
  env.db.raw.run('DELETE FROM live_harness_edges WHERE group_id = ?', [env.groupId])
  const off = sendAgentMessage(env.db, { from: a.id, to: b.id, payload: 'off', origin: 'test' })
  expect(off.payload).toBe('off')
  expect(
    env.db.raw.query<{ count: number }, []>('SELECT COUNT(*) count FROM harness_block_events').get()
      ?.count,
  ).toBe(0)
  process.env.BAZILION_HARNESS_ENFORCEMENT = 'on'
  expect(() =>
    sendAgentMessage(env.db, {
      from: a.id,
      to: b.id,
      payload: 'secret',
      origin: 'test',
      attemptKind: 'test',
      attemptId: 'deny',
    }),
  ).toThrow(CommunicationDeniedError)
  expect(
    env.db.raw
      .query<{ count: number }, []>("SELECT COUNT(*) count FROM messages WHERE payload = 'secret'")
      .get()?.count,
  ).toBe(0)
  expect(
    env.db.raw.query<{ count: number }, []>('SELECT COUNT(*) count FROM harness_block_events').get()
      ?.count,
  ).toBe(1)
  edge(env.groupId, 'agent', a.id, 'agent', b.id)
  const allowed = sendAgentMessage(env.db, {
    from: a.id,
    to: b.id,
    payload: 'ok',
    replyTo: off.id,
    origin: 'test',
  })
  expect(allowed.replyTo).toBe(off.id)
})

test('Agent inbox reauthorization atomically blocks stale deliveries while operator history remains visible', () => {
  const a = spawnAgent(env.db, env.paths, { profileId: 'p', groupId: env.groupId })
  const b = spawnAgent(env.db, env.paths, { profileId: 'p', groupId: env.groupId })
  const message = messageRepo.send(env.db, { from: a.id, to: b.id, payload: 'historical' })
  env.db.raw.run('DELETE FROM live_harness_edges WHERE group_id = ?', [env.groupId])
  process.env.BAZILION_HARNESS_ENFORCEMENT = 'on'
  expect(deliverableInbox(env.db, b.id, true)).toEqual([])
  expect(deliverableInbox(env.db, b.id, true)).toEqual([])
  expect(messageRepo.listInboxForOperator(env.db, b.id)).toMatchObject([
    { id: message.id, payload: 'historical' },
  ])
  expect(
    env.db.raw
      .query<{ policy_disposition: string }, [string]>(
        'SELECT policy_disposition FROM messages WHERE id = ?',
      )
      .get(message.id)?.policy_disposition,
  ).toBe('policy_blocked')
  expect(
    env.db.raw.query<{ count: number }, []>('SELECT COUNT(*) count FROM harness_block_events').get()
      ?.count,
  ).toBe(1)
})
