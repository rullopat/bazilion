import { afterEach, expect, test } from 'vitest'
import { turnFailureCause } from '../../src/core/attention.ts'
import {
  acknowledgeAllAttention,
  acknowledgeAttention,
  attentionSummary,
  initSchema,
  openInMemoryDb,
  projectAttention,
} from '../../src/core/index.ts'
import * as conversations from '../../src/core/repos/conversations.ts'
import { INTERRUPTED_BY_RESTART } from '../../src/core/repos/user-queue.ts'
import {
  forgetTurnFailure,
  forgetTurnFailures,
  rememberTurnFailure,
} from '../../src/core/turn-failures.ts'

const databases: ReturnType<typeof openInMemoryDb>[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})

function fixture() {
  const db = openInMemoryDb('')
  initSchema(db)
  databases.push(db)
  db.raw.run("INSERT INTO teams (id,name,created_at) VALUES ('team','Team',1)")
  db.raw.run(
    "INSERT INTO profiles (id,name,default_model,created_at,updated_at) VALUES ('profile','Profile','lmstudio:model',1,1)",
  )
  db.raw.run(
    "INSERT INTO agents (id,profile_id,name,status,team_id,created_at) VALUES ('agent','profile','Agent','idle','team',1)",
  )
  // A second Agent whose follow-up queue a restart paused: an item only resuming it clears.
  db.raw.run(
    "INSERT INTO agents (id,profile_id,name,status,team_id,created_at) VALUES ('paused','profile','Paused','idle','team',1)",
  )
  db.raw.run("INSERT INTO user_queue_controls (agent_id,paused) VALUES ('paused',1)")
  conversations.create(db, 'paused', '22222222-2222-4222-8222-222222222222')
  db.raw.run(
    `INSERT INTO user_queue_items (id,agent_id,conversation_id,source,status,text,diagnostic,created_at,updated_at,finished_at)
     VALUES ('cut','paused','22222222-2222-4222-8222-222222222222','http','failed','hi',?,11,21,21)`,
    [INTERRUPTED_BY_RESTART],
  )
  db.raw.run(
    "INSERT INTO agent_triggers (id,agent_id,kind,interval_sec,message,created_at) VALUES ('trigger','agent','interval',60,'run',1)",
  )
  conversations.create(db, 'agent', '11111111-1111-4111-8111-111111111111')
  db.raw.run(
    "INSERT INTO trigger_dispatches (id,trigger_id,agent_id,conversation_id,scheduled_at,status,finished_at,error) VALUES ('dispatch','trigger','agent','11111111-1111-4111-8111-111111111111',12,'failed',22,'provider rejected sk-supersecret123')",
  )
  db.raw.run(
    "INSERT INTO agent_loop_break_events (id,causal_chain_id,from_agent_id,to_agent_id,source_team_id,target_team_id,attempted_hop,max_hops,reason,origin,created_at) VALUES ('loop','chain','agent','agent','team','team',9,8,'causal_hop_limit_exceeded','test',13)",
  )
  return db
}

test('projects source-owned action items and acknowledgeable terminal signals', () => {
  const db = fixture()
  const list = projectAttention(db, { state: 'open', limit: 100 })
  expect(list.degraded).toEqual([])
  expect(list.items.map((item) => item.kind)).toEqual([
    'trigger_failure',
    'queue_interrupted',
    'agent_loop_break',
  ])
  expect(list.items.find((item) => item.kind === 'queue_interrupted')).toMatchObject({
    acknowledgeable: false,
    href: '/?agent=paused',
  })
  expect(JSON.stringify(list)).not.toContain('sk-supersecret123')
  expect(() => acknowledgeAttention(db, 'queue_interrupted:queue:paused', true)).toThrow(
    'action-required items must be resolved at their source',
  )
  expect(acknowledgeAttention(db, 'trigger_failure:dispatch', true).acknowledgedAt).not.toBeNull()
  expect(
    projectAttention(db, { state: 'open', limit: 100 }).items.map((item) => item.key),
  ).not.toContain('trigger_failure:dispatch')
  expect(acknowledgeAttention(db, 'trigger_failure:dispatch', false).acknowledgedAt).toBeNull()
})

test('summary matches the open projection and acknowledge-all excludes decisions', () => {
  const db = fixture()
  expect(attentionSummary(db)).toMatchObject({
    openTotal: 3,
    bySeverity: { action_required: 1, error: 1, warning: 1 },
  })
  expect(acknowledgeAllAttention(db)).toBe(2)
  expect(projectAttention(db, { state: 'open', limit: 100 }).items.map((item) => item.key)).toEqual(
    ['queue_interrupted:queue:paused'],
  )
})

test('a failed source degrades independently', () => {
  const db = fixture()
  db.raw.run('DROP TABLE trigger_dispatches')
  const list = projectAttention(db, { state: 'open', limit: 100 })
  expect(list.degraded).toEqual([expect.objectContaining({ kind: 'trigger_failure' })])
  expect(list.items.some((item) => item.kind === 'queue_interrupted')).toBe(true)
})

function failedFollowUp(
  db: ReturnType<typeof openInMemoryDb>,
  id: string,
  at: number,
  diagnostic: string | null,
  source: 'http' | 'telegram' = 'http',
) {
  db.raw.run(
    `INSERT INTO user_queue_items (id,agent_id,conversation_id,source,status,text,diagnostic,created_at,updated_at,finished_at)
     VALUES (?,'agent','11111111-1111-4111-8111-111111111111',?,'failed','hi',?,?,?,?)`,
    [id, source, diagnostic, at, at, at],
  )
}

test('failed background turns: one item per Agent and cause, reopened by a later failure', () => {
  const db = fixture()
  forgetTurnFailures()
  failedFollowUp(db, 'q1', 100, '401 Unauthorized: invalid x-api-key')
  failedFollowUp(db, 'q2', 200, '401: {"error":"invalid_api_key"}', 'telegram')
  failedFollowUp(db, 'q3', 150, 'Worker exited with code 3')
  // A follow-up the restart interrupted is the paused queue's item, not this one.
  failedFollowUp(db, 'q4', 160, INTERRUPTED_BY_RESTART)
  rememberTurnFailure({
    id: 'inbox:m1',
    agentId: 'agent',
    origin: 'inbox',
    at: 300,
    reason: '429 rate limit',
  })
  rememberTurnFailure({
    id: 'inbox:m2',
    agentId: 'gone',
    origin: 'inbox',
    at: 300,
    reason: '429 rate limit',
  })

  const items = () => projectAttention(db, { state: 'all', kind: 'turn_failure', limit: 100 }).items
  const byCause = (cause: string) => items().find((item) => item.sourceId === `agent:${cause}`)
  expect(items()).toHaveLength(3)
  expect(byCause('credentials')).toMatchObject({
    title: '2 background turns failed',
    severity: 'error',
    occurredAt: 100,
    updatedAt: 200,
    acknowledgeable: true,
    acknowledgedAt: null,
    href: '/?agent=agent',
  })
  expect(byCause('credentials')?.diagnostic).toBe(
    'The provider refused the credentials: 401: {"error":"invalid_api_key"} (1 follow-up, 1 Telegram message)',
  )
  expect(byCause('limit')).toMatchObject({
    title: 'Turn for new mail failed',
    href: '/?agent=agent&section=mailbox',
  })
  const other = items().find((item) => item.diagnostic.startsWith('The turn failed'))
  expect(other?.title).toBe('Follow-up failed')

  const credentials = byCause('credentials')?.key ?? ''
  expect(acknowledgeAttention(db, credentials, true).acknowledgedAt).not.toBeNull()
  // A later failure of the same cause opens it again, counting only what came after.
  failedFollowUp(db, 'q5', Date.now() + 1000, '401 Unauthorized')
  expect(byCause('credentials')).toMatchObject({ title: 'Follow-up failed', acknowledgedAt: null })
  // Retrying or removing the failed follow-ups leaves the item.
  db.raw.run("DELETE FROM user_queue_items WHERE id IN ('q1','q2','q5')")
  expect(byCause('credentials')).toBeUndefined()
  forgetTurnFailures()
  expect(byCause('limit')).toBeUndefined()
})

test('a wake-up that cannot start is one item, gone once it starts', () => {
  forgetTurnFailures()
  const db = fixture()
  rememberTurnFailure({
    id: 'inbox-start:agent',
    agentId: 'agent',
    origin: 'inbox',
    at: 1,
    reason: 'bad shell',
  })
  rememberTurnFailure({
    id: 'inbox-start:agent',
    agentId: 'agent',
    origin: 'inbox',
    at: 2,
    reason: 'bad shell',
  })
  const list = () => projectAttention(db, { state: 'open', kind: 'turn_failure' }).items
  expect(list()).toHaveLength(1)
  expect(list()[0]?.title).toBe('Turn for new mail failed')
  expect(forgetTurnFailure('inbox-start:agent')).toBe(true)
  expect(list()).toEqual([])
  expect(turnFailureCause('Worker 1234 exited')).toBe(turnFailureCause('Worker 99 exited'))
  expect(turnFailureCause('500 overloaded_error (request req_011CXyzAbc)')).toBe(
    turnFailureCause('500 overloaded_error (request req_022QwErTyu)'),
  )
})
