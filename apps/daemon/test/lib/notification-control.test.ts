import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as receipts from '../../src/core/repos/notifications.ts'
import { NotificationControl } from '../../src/lib/notification-control.ts'
import { NotificationDispatcher } from '../../src/lib/notification-dispatch.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
let control: NotificationControl
let now: number
const binding: receipts.NotificationBinding = {
  id: 'a'.repeat(64),
  chatId: -100,
  topicId: 7,
  ownerGrantId: 'owner',
  botDigest: 'digest',
}
const verify = vi.fn()
beforeEach(() => {
  env = makeTestEnv()
  now = 100
  vi.stubEnv('BAZILION_TEAM_POLICY_ENFORCEMENT', 'off')
  createProfile(env.db, env.paths, { id: 'control', defaultModel: 'lmstudio:test' })
  const agent = spawnAgent(env.db, env.paths, { profileId: 'control', teamId: env.teamId })
  env.db.raw.run(
    `INSERT INTO agent_reviews (id,agent_id,status,trigger_kind,next_attempt_at,last_error,created_at,updated_at)
    VALUES ('review',?,'failed','manual',1,'PRIVATE',10,20)`,
    [agent.id],
  )
  verify.mockReset().mockResolvedValue(true)
  control = new NotificationControl(
    env.db,
    { capture: () => binding, verify, send: vi.fn() },
    () => now,
  )
})
afterEach(() => {
  vi.unstubAllEnvs()
  env.cleanup()
})
function input() {
  const settings = receipts.settings(env.db)
  return {
    expectedRevision: settings.revision,
    enabled: true,
    kinds: settings.kinds,
    timezone: 'UTC',
    quietHours: null,
    destinationId: binding.id,
  }
}
test('first enable and re-enable use fresh cutoffs without implicitly capturing old sources', async () => {
  await control.configure(input())
  expect(receipts.settings(env.db).eligibleAfter).toBe(100)
  expect(receipts.list(env.db).receipts).toHaveLength(0)
  await control.configure({ ...input(), enabled: false })
  now = 200
  await control.configure(input())
  expect(receipts.settings(env.db).eligibleAfter).toBe(200)
  expect(receipts.list(env.db).receipts).toHaveLength(0)
})
test('explicit preview captures old items and cannot be reused against another revision', async () => {
  const preview = await control.preview(input().kinds)
  expect(preview.count).toBe(1)
  expect(JSON.stringify(preview)).not.toContain('PRIVATE')
  await control.configure({ ...input(), includeOpenPreview: preview.id })
  expect(receipts.list(env.db).receipts).toHaveLength(1)
  await expect(control.configure({ ...input(), includeOpenPreview: preview.id })).rejects.toThrow(
    'preview',
  )
})
test('resolved preview sources are omitted, and invalid readiness cannot enable', async () => {
  const preview = await control.preview(input().kinds)
  env.db.raw.run("UPDATE agent_reviews SET status='completed' WHERE id='review'")
  await control.configure({ ...input(), includeOpenPreview: preview.id })
  expect(receipts.list(env.db).receipts).toHaveLength(0)
  await control.configure({ ...input(), enabled: false })
  verify.mockResolvedValue(false)
  await expect(control.configure(input())).rejects.toThrow('destination_unavailable')
  expect(receipts.settings(env.db).enabled).toBe(false)
})
test('preview expiry and a settings change during readiness cannot authorize old input', async () => {
  const preview = await control.preview(input().kinds)
  now += 300_001
  await expect(control.configure({ ...input(), includeOpenPreview: preview.id })).rejects.toThrow(
    'preview',
  )
  const stale = input()
  verify.mockImplementationOnce(async () => {
    const current = receipts.settings(env.db)
    receipts.saveSettings(env.db, current.revision, current, null, now)
    return true
  })
  await expect(control.configure(stale)).rejects.toThrow('settings_conflict')
})
test('retry rechecks settings after readiness and cannot revive a disabled notification', async () => {
  const preview = await control.preview(input().kinds)
  await control.configure({ ...input(), includeOpenPreview: preview.id })
  const receipt = receipts.list(env.db).receipts[0]
  if (!receipt) throw new Error('Missing fixture receipt')
  receipts.claim(env.db, receipt.id)
  receipts.settle(env.db, receipt.id, 1, 'uncertain', 'delivery_uncertain')
  const uncertain = receipts.get(env.db, receipt.id)
  if (!uncertain) throw new Error('Missing fixture receipt')
  verify.mockImplementationOnce(async () => {
    const settings = receipts.settings(env.db)
    receipts.saveSettings(env.db, settings.revision, { ...settings, enabled: false }, binding)
    return true
  })
  await expect(control.retry(receipt.id, uncertain.updatedAt, true)).rejects.toThrow(
    'retry_not_enabled',
  )
  expect(receipts.get(env.db, receipt.id)?.state).toBe('uncertain')
})
test('future-only enable distinguishes an existing source from a new source in the same millisecond', async () => {
  now = 20 // The fixture review already exists with this updated_at.
  await control.configure(input())
  const old = receipts.list(env.db).receipts[0]
  expect(old).toMatchObject({
    sourceId: 'review',
    state: 'suppressed',
    diagnostic: 'future_baseline',
  })
  env.db.raw.run(`INSERT INTO agent_reviews (id,agent_id,status,trigger_kind,next_attempt_at,created_at,updated_at)
    SELECT 'new-review',agent_id,'failed','manual',20,20,20 FROM agent_reviews WHERE id='review'`)
  const send = vi.fn(async () => ({ message_id: 101 }))
  await new NotificationDispatcher(
    env.db,
    { capture: () => binding, verify, send },
    () => now,
  ).tick()
  expect(send).toHaveBeenCalledOnce()
  expect(receipts.list(env.db).receipts.find((item) => item.sourceId === 'new-review')?.state).toBe(
    'delivered',
  )
  expect(receipts.get(env.db, old?.id ?? '')?.state).toBe('suppressed')
})
test('adding a kind preserves pending notices and missed eligibility for unchanged kinds', async () => {
  const preview = await control.preview(['review_failure'])
  await control.configure({ ...input(), kinds: ['review_failure'], includeOpenPreview: preview.id })
  env.db.raw.run(`INSERT INTO agent_reviews (id,agent_id,status,trigger_kind,next_attempt_at,created_at,updated_at)
    SELECT 'later-review',agent_id,'failed','manual',150,150,150 FROM agent_reviews WHERE id='review'`)
  env.db.raw.run(`INSERT INTO agent_lesson_proposals
    (id,review_id,agent_id,scope,text,evidence_json,status,created_at,updated_at)
    SELECT 'old-lesson','review',agent_id,'private','PRIVATE','[]','pending',20,20 FROM agent_reviews WHERE id='review'`)
  now = 200
  await control.configure({ ...input(), kinds: ['review_failure', 'lesson_proposal'] })
  expect(receipts.eligibilityCutoffs(env.db)).toEqual({ review_failure: 100, lesson_proposal: 200 })
  expect(receipts.list(env.db).receipts[0]?.state).toBe('deferred')
  const send = vi.fn(async () => ({ message_id: 101 }))
  await new NotificationDispatcher(
    env.db,
    { capture: () => binding, verify, send },
    () => now,
  ).tick()
  expect(send).toHaveBeenCalledTimes(2)
  expect(
    receipts
      .list(env.db)
      .receipts.map((item) => item.sourceId)
      .sort(),
  ).toEqual(['later-review', 'review'])
})
test('removing and re-adding a kind suppresses its pending notices without resetting other cutoffs', async () => {
  await control.configure({
    ...input(),
    kinds: ['review_failure', 'lesson_proposal'],
    quietHours: { start: '00:00', end: '01:00' },
  })
  env.db.raw.run("UPDATE agent_reviews SET updated_at=150 WHERE id='review'")
  now = 150
  const send = vi.fn(async () => ({ message_id: 101 }))
  const dispatcher = new NotificationDispatcher(
    env.db,
    { capture: () => binding, verify, send },
    () => now,
  )
  await dispatcher.tick()
  expect(receipts.list(env.db).receipts[0]?.state).toBe('deferred')
  now = 200
  await control.configure({ ...input(), kinds: ['lesson_proposal'] })
  expect(receipts.list(env.db).receipts[0]?.diagnostic).toBe('kind_disabled')
  now = 300
  await control.configure({ ...input(), kinds: ['review_failure', 'lesson_proposal'] })
  expect(receipts.eligibilityCutoffs(env.db)).toEqual({ review_failure: 300, lesson_proposal: 100 })
  await dispatcher.tick()
  expect(send).not.toHaveBeenCalled()
})
