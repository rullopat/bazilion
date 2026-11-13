import type { Api } from 'grammy'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { attentionSummary, projectAttention } from '../../src/core/attention.ts'
import type { BazilionDb } from '../../src/core/db/client.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import { openConfig } from '../../src/core/repos/config.ts'
import * as conversations from '../../src/core/repos/conversations.ts'
import * as notificationSettings from '../../src/core/repos/notifications.ts'
import * as queue from '../../src/core/repos/user-queue.ts'
import { sendAttentionNotifications } from '../../src/lib/notifications.ts'
import { setTelegramLive } from '../../src/lib/telegram/live.ts'
import { _resetOutboundQueueForTest } from '../../src/lib/telegram/outbound-queue.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

/** Failures stay visible to the owner: each one injected here must show up in Attention. */

// --- Rows: daemon kill mid-queue-dispatch / mid-turn → queue interrupted ----

describe('a daemon crash pauses the queue and the pause is visible', () => {
  let env: TestEnv
  let agentId: string
  let conversationId: string
  beforeEach(() => {
    env = makeTestEnv()
    createProfile(env.db, env.paths, { id: 'profiles', defaultModel: 'lmstudio:test' })
    agentId = spawnAgent(env.db, env.paths, { profileId: 'profiles', teamId: env.teamId }).id
    conversationId = conversations.create(
      env.db,
      agentId,
      '11111111-1111-4111-8111-111111111111',
    ).id
  })
  afterEach(() => env.cleanup())

  function seedQueueItem(db: BazilionDb, id: string, status: 'running' | 'pending'): void {
    // A SIGKILL mid-turn leaves the item it was running in 'running'.
    db.raw.run(
      `INSERT INTO user_queue_items (id, agent_id, conversation_id, source, status, text, created_at, updated_at)
       VALUES (?, ?, ?, 'http', ?, 'hello', 10, 10)`,
      [id, agentId, conversationId, status],
    )
  }

  test('the crash-paused queue surfaces as an action-required attention item', () => {
    seedQueueItem(env.db, 'item-1', 'running')
    seedQueueItem(env.db, 'item-2', 'pending')

    // Boot recovery runs on daemon start after the kill.
    expect(queue.recoverInterrupted(env.db)).toBe(1)
    expect(queue.get(env.db, agentId, 'item-1')?.status).toBe('failed')

    const items = projectAttention(env.db, { state: 'open', limit: 100 }).items
    const item = items.find((i) => i.kind === 'queue_interrupted')
    expect(item).toBeDefined()
    expect(item?.severity).toBe('action_required')
    expect(item?.title).toMatch(/paused after a daemon restart/i)
    expect(item?.diagnostic).toContain('1 follow-up waits')
    expect(item?.agentId).toBe(agentId)
    expect(item?.href).toBe(`/agents/${agentId}`)
    expect(item?.acknowledgeable).toBe(false)
    expect(attentionSummary(env.db).byKind.queue_interrupted).toBe(1)
  })

  test('the paused queue keeps new input waiting, then runs it on resume and the item clears', () => {
    seedQueueItem(env.db, 'item-1', 'running')
    queue.recoverInterrupted(env.db)
    expect(queue.isPaused(env.db, agentId)).toBe(true)
    seedQueueItem(env.db, 'item-2', 'pending')
    expect(queue.claim(env.db, agentId)).toBeNull()

    // Resuming — the action the attention item points at — clears it; the interrupted item is
    // never run again.
    queue.setPaused(env.db, agentId, false)
    expect(projectAttention(env.db, { state: 'open', limit: 100 }).items).toHaveLength(0)
    expect(queue.claim(env.db, agentId)?.item.id).toBe('item-2')
  })
})

// --- Row: Telegram send failure → the item stays open and unmarked ---------

describe('a Telegram send failure stays visible', () => {
  let env: TestEnv
  const sendMessage = vi.fn()
  beforeEach(() => {
    env = makeTestEnv()
    createProfile(env.db, env.paths, { id: 'notices', defaultModel: 'lmstudio:test' })
    const agentId = spawnAgent(env.db, env.paths, {
      profileId: 'notices',
      teamId: env.teamId,
    }).id
    env.db.raw.run(
      `INSERT INTO agent_reviews (id, agent_id, status, trigger_kind, last_error, created_at, updated_at)
       VALUES ('review', ?, 'failed', 'manual', 'provider exploded', 10, 20)`,
      [agentId],
    )
    notificationSettings.save(
      env.db,
      { enabled: true, kinds: ['review_failure'], timezone: 'UTC', quietHours: null },
      1,
    )
    openConfig(env.db).set('TELEGRAM_SERVICE_TOPIC_ID', '7')
    sendMessage.mockReset()
    setTelegramLive({
      api: { sendMessage } as unknown as Api,
      chatId: -100,
      db: env.db,
      paths: env.paths,
    })
  })
  afterEach(() => {
    setTelegramLive(null)
    _resetOutboundQueueForTest()
    env.cleanup()
  })

  test('a rejected notice leaves the attention item open and is tried again', async () => {
    sendMessage.mockRejectedValue({ error_code: 403, description: 'Forbidden: bot was blocked' })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await sendAttentionNotifications(env.db)
    await sendAttentionNotifications(env.db)

    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(notificationSettings.notifiedKeys(env.db).size).toBe(0)
    const stillOpen = projectAttention(env.db, { state: 'open', limit: 100 }).items
    expect(stillOpen.some((i) => i.kind === 'review_failure' && i.sourceId === 'review')).toBe(true)
  })
})
