import { join } from 'node:path'
import type { AttentionItem } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { pauseRestoredUserQueue } from '../../../cli/src/backup-queue-recovery.ts'
import { openDb } from '../../src/core/db/client.ts'
import * as notices from '../../src/core/repos/notifications.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

let env: TestEnv
const binding: notices.NotificationBinding = {
  id: 'destination',
  chatId: -100,
  topicId: 7,
  ownerGrantId: 'owner-grant',
  botDigest: 'credential-digest',
}
const source: AttentionItem = {
  key: 'trigger_failure:source',
  kind: 'trigger_failure',
  sourceId: 'source',
  severity: 'error',
  occurredAt: 1,
  updatedAt: 1,
  agentId: 'agent',
  teamId: 'team',
  title: 'PRIVATE_TITLE',
  diagnostic: 'PRIVATE_PAYLOAD',
  href: '/agents/agent',
  acknowledgeable: true,
  acknowledgedAt: null,
}
beforeEach(() => {
  env = makeTestEnv()
})
afterEach(() => env.cleanup())
function enable() {
  const current = notices.settings(env.db)
  return notices.saveSettings(
    env.db,
    current.revision,
    {
      ...current,
      enabled: true,
      restorePaused: false,
      eligibleAfter: 100,
    },
    binding,
    100,
  )
}
test('default off, revision checked settings and public state exclude private binding identity', () => {
  expect(notices.settings(env.db)).toMatchObject({
    enabled: false,
    restorePaused: false,
    revision: 0,
  })
  const enabled = enable()
  expect(enabled.enabled).toBe(true)
  expect(JSON.stringify(enabled)).not.toContain('credential-digest')
  expect(() => notices.saveSettings(env.db, 0, enabled, binding)).toThrow('conflict')
  const receipt = notices.admit(env.db, source, binding)
  notices.saveSettings(env.db, enabled.revision, { ...enabled, enabled: false }, binding)
  expect(notices.get(env.db, receipt.id)?.state).toBe('suppressed')
})
test('one canonical source/destination receipt and one sender survive repeated polls', () => {
  const item = notices.admit(env.db, source, binding, 100)
  expect(notices.admit(env.db, { ...source, diagnostic: 'CHANGED' }, binding, 200).id).toBe(item.id)
  const claimed = notices.claim(env.db, item.id, 200)
  expect(claimed?.attempts).toBe(1)
  expect(notices.claim(env.db, item.id, 201)).toBeNull()
  expect(notices.settle(env.db, item.id, 1, 'delivered', null, 90, 202)).toBe(true)
  expect(notices.settle(env.db, item.id, 1, 'uncertain', 'timeout')).toBe(false)
  notices.recoverInterrupted(env.db, 300)
  expect(notices.get(env.db, item.id)?.state).toBe('delivered')
  expect(JSON.stringify(notices.list(env.db))).not.toMatch(/PRIVATE_|credential-digest|owner-grant/)
  expect(notices.admit(env.db, source, binding).id).toBe(item.id)
})
test('restart uncertainty requires an explicit revision-bound duplicate acknowledgement', () => {
  const item = notices.admit(env.db, source, binding, 100)
  notices.claim(env.db, item.id, 200)
  notices.recoverInterrupted(env.db, 300)
  const uncertain = notices.get(env.db, item.id)
  if (!uncertain) throw new Error('Missing notification fixture')
  expect(uncertain.state).toBe('uncertain')
  expect(() => notices.retry(env.db, item.id, uncertain.updatedAt, false)).toThrow(
    'acknowledgement',
  )
  expect(() => notices.retry(env.db, item.id, 100, true)).toThrow('conflict')
  notices.retry(env.db, item.id, uncertain.updatedAt, true, 400)
  expect(() => notices.retry(env.db, item.id, uncertain.updatedAt, true)).toThrow('conflict')
  expect(notices.claim(env.db, item.id, 500)?.attempts).toBe(2)
  expect(notices.settle(env.db, item.id, 1, 'delivered', null, 91)).toBe(false)
  expect(notices.settle(env.db, item.id, 2, 'delivered', null, 92)).toBe(true)
})
test('restored snapshot stays paused when Telegram could have received a later send', () => {
  enable()
  const item = notices.admit(env.db, source, binding, 101)
  const path = join(env.home, 'notification-snapshot.db')
  env.db.raw.run('VACUUM INTO ?', [path])
  notices.claim(env.db, item.id, 200)
  notices.settle(env.db, item.id, 1, 'delivered', null, 99, 201)
  pauseRestoredUserQueue(path)
  const restored = openDb(path)
  try {
    expect(notices.settings(restored)).toMatchObject({ enabled: false, restorePaused: true })
    expect(notices.get(restored, item.id)?.state).toBe('suppressed')
    expect(notices.claim(restored, item.id)).toBeNull()
    notices.recoverInterrupted(restored)
    expect(notices.settings(restored).restorePaused).toBe(true)
    expect(notices.get(env.db, item.id)?.state).toBe('delivered')
  } finally {
    restored.close()
  }
})
test('bounded receipt pages are stable when creation timestamps tie', () => {
  for (let i = 0; i < 4; i++)
    notices.admit(env.db, { ...source, sourceId: String(i) }, binding, 100)
  const first = notices.list(env.db, { limit: 2 })
  const second = notices.list(env.db, { limit: 2, cursor: first.nextCursor ?? undefined })
  expect(new Set([...first.receipts, ...second.receipts].map((item) => item.id)).size).toBe(4)
  expect(second.nextCursor).toBeNull()
})
test('deferred dispatch is oldest-first and invalid limits cannot make an unbounded read', () => {
  const old = notices.admit(env.db, source, binding, 100)
  notices.admit(env.db, { ...source, sourceId: 'newer' }, binding, 200)
  expect(notices.list(env.db, { deferredOnly: true, limit: 1 }).receipts[0]?.id).toBe(old.id)
  expect(() => notices.list(env.db, { limit: Number.NaN })).toThrow('limit_invalid')
})
test('capacity rejects new sources without evicting confirmed deduplication keys', () => {
  const item = notices.admit(env.db, source, binding, 100)
  notices.claim(env.db, item.id, 101)
  notices.settle(env.db, item.id, 1, 'delivered', null, 99, 102)
  env.db.raw.run(
    `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x < ?)
    INSERT INTO notification_receipts (id, source_kind, source_id, destination_id, destination_json,
      state, created_at, updated_at) SELECT 'capacity-'||x, 'trigger_failure', 'capacity-'||x,
      'destination', ?, 'suppressed', 1, 1 FROM n`,
    [notices.NOTIFICATION_RECEIPT_LIMIT - 1, JSON.stringify(binding)],
  )
  expect(() => notices.admit(env.db, { ...source, sourceId: 'overflow' }, binding)).toThrow(
    'capacity',
  )
  expect(notices.admit(env.db, source, binding).state).toBe('delivered')
})
