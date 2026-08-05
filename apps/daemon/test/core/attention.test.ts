import { afterEach, expect, test } from 'vitest'
import {
  acknowledgeAllAttention,
  acknowledgeAttention,
  attentionSummary,
  openInMemoryDb,
  projectAttention,
  runMigrations,
} from '../../src/core/index.ts'

const databases: ReturnType<typeof openInMemoryDb>[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})

function fixture() {
  const db = openInMemoryDb()
  runMigrations(db)
  databases.push(db)
  db.raw.run("INSERT INTO teams (id,name,created_at) VALUES ('team','Team',1)")
  db.raw.run(
    "INSERT INTO profiles (id,name,dir,default_model,created_at,updated_at) VALUES ('profile','Profile','p','lmstudio:model',1,1)",
  )
  db.raw.run(
    "INSERT INTO agents (id,profile_id,name,status,dir,team_id,created_at) VALUES ('agent','profile','Agent','idle','a','team',1)",
  )
  db.raw.run(
    "INSERT INTO agent_reviews (id,agent_id,status,trigger_kind,next_attempt_at,last_error,created_at,updated_at) VALUES ('review','agent','failed','manual',1,'safe failure sk-supersecret123',10,20)",
  )
  db.raw.run(
    "INSERT INTO agent_lesson_proposals (id,review_id,agent_id,scope,text,evidence_json,status,created_at,updated_at) VALUES ('lesson','review','agent','private','Do this','[]','pending',11,21)",
  )
  db.raw.run(
    "INSERT INTO agent_triggers (id,agent_id,kind,interval_sec,message,created_at) VALUES ('trigger','agent','interval',60,'run',1)",
  )
  db.raw.run(
    "INSERT INTO trigger_dispatches (id,trigger_id,agent_id,scheduled_at,status,next_attempt_at,last_error,created_at,updated_at) VALUES ('dispatch','trigger','agent',12,'failed',12,'provider secret-free error',12,22)",
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
    'lesson_proposal',
    'review_failure',
    'agent_loop_break',
  ])
  expect(list.items.find((item) => item.kind === 'lesson_proposal')).toMatchObject({
    acknowledgeable: false,
    href: '/agents/agent/learning',
  })
  expect(JSON.stringify(list)).not.toContain('sk-supersecret123')
  expect(() => acknowledgeAttention(db, 'lesson_proposal:lesson', true)).toThrow(
    'attention_action_required',
  )
  expect(acknowledgeAttention(db, 'review_failure:review', true).acknowledgedAt).not.toBeNull()
  expect(
    projectAttention(db, { state: 'open', limit: 100 }).items.map((item) => item.key),
  ).not.toContain('review_failure:review')
  expect(acknowledgeAttention(db, 'review_failure:review', false).acknowledgedAt).toBeNull()
})

test('summary matches the open projection and acknowledge-all excludes decisions', () => {
  const db = fixture()
  expect(attentionSummary(db)).toMatchObject({
    openTotal: 4,
    bySeverity: { action_required: 1, error: 2, warning: 1 },
  })
  expect(acknowledgeAllAttention(db)).toBe(3)
  expect(projectAttention(db, { state: 'open', limit: 100 }).items.map((item) => item.key)).toEqual(
    ['lesson_proposal:lesson'],
  )
})

test('a failed source degrades independently', () => {
  const db = fixture()
  db.raw.run('DROP TABLE trigger_dispatches')
  const list = projectAttention(db, { state: 'open', limit: 100 })
  expect(list.degraded).toEqual([expect.objectContaining({ kind: 'trigger_failure' })])
  expect(list.items.some((item) => item.kind === 'lesson_proposal')).toBe(true)
})
