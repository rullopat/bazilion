import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { pauseRestoredUserQueue } from '../../../cli/src/backup-queue-recovery.ts'
import { openDb } from '../../src/core/db/client.ts'
import { openInMemoryDb, projectAttention, runMigrations } from '../../src/core/index.ts'
import * as conversations from '../../src/core/repos/conversations.ts'
import * as receipts from '../../src/core/repos/notifications.ts'
import { NotificationControl } from '../../src/lib/notification-control.ts'
import { NotificationDispatcher } from '../../src/lib/notification-dispatch.ts'
import { _resetOutboundQueueForTest } from '../../src/lib/telegram/outbound-queue.ts'

const binding: receipts.NotificationBinding = {
  id: 'a'.repeat(64),
  chatId: -100,
  topicId: 7,
  ownerGrantId: 'owner',
  botDigest: 'digest',
}
afterEach(() => {
  vi.unstubAllEnvs()
  _resetOutboundQueueForTest()
})
function fixture() {
  const db = openInMemoryDb()
  runMigrations(db)

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
  conversations.create(
    db,
    'agent',
    {
      requestId: '11111111-1111-4111-8111-111111111111',
      expectedSelection: { conversationId: null, revision: 0 },
    },
    (id) => `${id}.jsonl`,
  )
  db.raw.run(
    "INSERT INTO trigger_dispatches (id,trigger_id,agent_id,conversation_id,scheduled_at,status,next_attempt_at,last_error,created_at,updated_at) VALUES ('dispatch','trigger','agent','11111111-1111-4111-8111-111111111111',12,'failed',12,'provider secret-free error',12,22)",
  )
  db.raw.run(
    "INSERT INTO agent_loop_break_events (id,causal_chain_id,from_agent_id,to_agent_id,source_team_id,target_team_id,attempted_hop,max_hops,reason,origin,created_at) VALUES ('loop','chain','agent','agent','team','team',9,8,'causal_hop_limit_exceeded','test',13)",
  )
  return db
}
function addApproval(db: ReturnType<typeof fixture>) {
  db.raw.run(
    `INSERT INTO communication_approvals
    (id,attempt_kind,attempt_id,fingerprint,operation,source_kind,source_id,target_kind,target_id,
    source_team_id,target_team_id,channel,origin,requester,policy_refs_json,required_edge_ids_json,
    payload_kind,payload_json,status,expires_at,created_at,updated_at)
    VALUES ('approval','fixture','fixture','fingerprint','egress','agent','agent','user','',
    'team','team','user','fixture','operator','[]','[]','fixture','{"private":"SECRET"}',
    'pending',?,30,30)`,
    [Date.now() + 60000],
  )
}
function input(db: ReturnType<typeof fixture>) {
  const current = receipts.settings(db)
  return {
    expectedRevision: current.revision,
    enabled: true,
    kinds: current.kinds,
    timezone: 'UTC',
    quietHours: null,
    destinationId: binding.id,
  }
}
test('all five canonical sources notify once without mutating decisions or exposing payloads', async () => {
  const db = fixture()
  vi.stubEnv('BAZILION_TEAM_POLICY_ENFORCEMENT', 'off')
  try {
    addApproval(db)
    const before = projectAttention(db, { limit: 100 }).items
    expect(before.find((item) => item.kind === 'communication_approval')?.agentId).toBe('agent')
    const send = vi.fn(async () => ({ message_id: 100 }))
    const transport = { capture: () => binding, verify: async () => true, send }
    const control = new NotificationControl(db, transport, () => 100)
    const preview = await control.preview(input(db).kinds)
    expect(preview.count).toBe(5)
    await control.configure({ ...input(db), includeOpenPreview: preview.id })
    const dispatcher = new NotificationDispatcher(db, transport, () => 100)
    await dispatcher.tick()
    await dispatcher.tick()
    expect(send).toHaveBeenCalledTimes(5)
    expect(projectAttention(db, { limit: 100 }).items).toEqual(before)
    expect(receipts.list(db).receipts.every((item) => item.state === 'delivered')).toBe(true)
    for (const call of send.mock.calls)
      expect(JSON.stringify(call)).not.toMatch(/SECRET|sk-supersecret|Do this|provider secret-free/)
    expect(
      db.raw.query<{ n: number }, []>('SELECT COUNT(*) n FROM communication_approvals').get()?.n,
    ).toBe(1)
  } finally {
    db.close()
  }
})
test('restored old snapshots require explicit reconciliation and never replay automatically', async () => {
  const db = fixture()
  const home = mkdtempSync(join(tmpdir(), 'notification-restore-'))
  vi.stubEnv('BAZILION_TEAM_POLICY_ENFORCEMENT', 'off')
  try {
    const transport = {
      capture: () => binding,
      verify: async () => true,
      send: vi.fn(async () => ({ message_id: 100 })),
    }
    const control = new NotificationControl(db, transport, () => 100)
    const preview = await control.preview(input(db).kinds)
    await control.configure({ ...input(db), includeOpenPreview: preview.id })
    const snapshot = join(home, 'snapshot.db')
    db.raw.run('VACUUM INTO ?', [snapshot])
    await new NotificationDispatcher(db, transport, () => 100).tick()
    expect(transport.send).toHaveBeenCalledTimes(4)
    pauseRestoredUserQueue(snapshot)
    const restored = openDb(snapshot)
    try {
      const send = vi.fn(async () => ({ message_id: 200 }))
      const restoredTransport = { ...transport, send }
      const restoredControl = new NotificationControl(restored, restoredTransport, () => 200)
      const dispatcher = new NotificationDispatcher(restored, restoredTransport, () => 200)
      await dispatcher.tick()
      expect(send).not.toHaveBeenCalled()
      const oldPreview = await restoredControl.preview(input(restored).kinds)
      expect(oldPreview).toMatchObject({ count: 4, possibleDuplicates: true })
      await restoredControl.configure(input(restored))
      await dispatcher.tick()
      expect(send).not.toHaveBeenCalled()
      const explicit = await restoredControl.preview(input(restored).kinds)
      expect(explicit.possibleDuplicates).toBe(true)
      await restoredControl.configure({ ...input(restored), includeOpenPreview: explicit.id })
      await dispatcher.tick()
      expect(send).toHaveBeenCalledTimes(4)
      expect(receipts.list(db).receipts.every((item) => item.state === 'delivered')).toBe(true)
    } finally {
      restored.close()
    }
  } finally {
    db.close()
    rmSync(home, { recursive: true, force: true })
  }
})
test('expired approvals and deleted source relations are suppressed after waiting', async () => {
  const db = fixture()
  vi.stubEnv('BAZILION_TEAM_POLICY_ENFORCEMENT', 'off')
  try {
    addApproval(db)
    const send = vi.fn(async () => ({ message_id: 100 }))
    const transport = { capture: () => binding, verify: async () => true, send }
    const control = new NotificationControl(db, transport, () => 100)
    const preview = await control.preview(input(db).kinds)
    await control.configure({
      ...input(db),
      includeOpenPreview: preview.id,
      quietHours: { start: '00:00', end: '01:00' },
    })
    const dispatcher = new NotificationDispatcher(db, transport, () => 100)
    await dispatcher.tick()
    expect(receipts.list(db).receipts).toHaveLength(5)
    db.raw.run("UPDATE communication_approvals SET expires_at=0 WHERE id='approval'")
    db.raw.run("DELETE FROM agents WHERE id='agent'")
    await dispatcher.tick()
    expect(send).not.toHaveBeenCalled()
    expect(receipts.list(db).receipts.every((item) => item.state === 'suppressed')).toBe(true)
  } finally {
    db.close()
  }
})
