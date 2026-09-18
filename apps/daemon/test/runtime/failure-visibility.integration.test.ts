import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { attentionSummary, projectAttention } from '../../src/core/attention.ts'
import { openDb, type BazilionDb } from '../../src/core/db/client.ts'
import { runMigrations } from '../../src/core/db/migrate.ts'
import type { CodingCommandReceipt } from '@bazilion/api-types'
import { interruptCodingCommands, saveCodingCommand } from '../../src/core/repos/coding-commands.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as receipts from '../../src/core/repos/notifications.ts'
import * as conversations from '../../src/core/repos/conversations.ts'
import * as queue from '../../src/core/repos/user-queue.ts'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { NotificationDispatcher } from '../../src/lib/notification-dispatch.ts'
import { _resetOutboundQueueForTest } from '../../src/lib/telegram/outbound-queue.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

/**
 * BAZ-051 — failure-mode visibility audit.
 *
 * One deterministic injection per failure-mode row. These tests assert the
 * OBSERVED operator surface (attention projection, queue diagnostics, receipt
 * states), not recovery internals: the recovery machinery's correctness is
 * covered by its own suites; here nothing is allowed to recover silently.
 */

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
      {
        requestId: '11111111-1111-4111-8111-111111111111',
        expectedSelection: { conversationId: null, revision: 0 },
      },
      (id) => `${id}.jsonl`,
    ).conversation.id
  })
  afterEach(() => env.cleanup())

  function seedCrashedQueueTurn(db: BazilionDb, id: string): void {
    // The state a SIGKILL mid-turn leaves behind: a claimed/running queue item.
    db.raw.run(
      `INSERT INTO user_queue_items (id, agent_id, team_id, conversation_id, source, attempt_id,
        input_digest, position, status, text, created_at, updated_at)
       VALUES (?, ?, ?, '${conversationId}', 'http', ?, 'digest', 1, 'running', 'hello', 10, 10)`,
      [id, agentId, env.teamId, `attempt-${id}`],
    )
  }

  test('the crash-paused queue surfaces as an action-required attention item naming the uncertain count', () => {
    seedCrashedQueueTurn(env.db, 'item-1')

    // Boot recovery runs on daemon start after the kill.
    const recovered = queue.recoverInterrupted(env.db)
    expect(recovered).toBe(1)

    const items = projectAttention(env.db, { state: 'open', limit: 100 }).items
    const item = items.find((i) => i.kind === 'queue_interrupted')
    expect(item).toBeDefined()
    expect(item?.severity).toBe('action_required')
    expect(item?.title).toMatch(/paused after a daemon restart/i)
    expect(item?.diagnostic).toContain('1 queued item is uncertain')
    expect(item?.agentId).toBe(agentId)
    expect(item?.href).toBe(`/agents/${agentId}`)
    expect(item?.acknowledgeable).toBe(false)
    expect(attentionSummary(env.db).byKind.queue_interrupted).toBe(1)
  })

  test('the paused queue buffers new input without draining, then drains on resume and the item clears', () => {
    seedCrashedQueueTurn(env.db, 'item-1')
    queue.recoverInterrupted(env.db)
    const control = queue.control(env.db, agentId)
    expect(control.paused).toBe(true)
    expect(control.reason).toBe('interrupted')

    // Enqueue while paused is accepted (deliberate pauses buffer)…
    env.db.raw.run(
      `INSERT INTO user_queue_items (id, agent_id, team_id, conversation_id, source, attempt_id,
        input_digest, position, status, text, created_at, updated_at)
       VALUES ('item-2', ?, ?, '${conversationId}', 'http', 'attempt-2', 'digest', 2, 'pending', 'again', 11, 11)`,
      [agentId, env.teamId],
    )
    // …and the pump must not claim it while the interruption is unresolved.
    expect(queue.claim(env.db, agentId)).toBeNull()

    // Resuming — the operator action the attention item points at — clears the
    // attention item. The pump still will not skip past the uncertain head by
    // design (a maybe-delivered message is never silently dropped): the
    // operator resolves it (exact retry supersedes it), then the queue drains.
    env.db.raw.run(
      'UPDATE user_queue_controls SET paused = 0, reason = NULL, revision = revision + 1 WHERE agent_id = ?',
      [agentId],
    )
    expect(projectAttention(env.db, { state: 'open', limit: 100 }).items).toHaveLength(0)
    expect(queue.claim(env.db, agentId)).toBeNull()
    env.db.raw.run(
      "UPDATE user_queue_items SET status = 'superseded', finished_at = 12 WHERE id = 'item-1'",
    )
    expect(queue.claim(env.db, agentId)?.id).toBe('item-2')
  })
})

// --- Row: daemon kill mid-coding-run → interrupted receipt is visible ------

test('a daemon kill mid-coding-run leaves a visible interrupted receipt, not a silent gap', async () => {
  // File-backed db: the kill window is a crash on disk, so the receipt must
  // survive the abrupt handle drop exactly as SIGKILL leaves it.
  const home = mkdtempSync(join(tmpdir(), 'bz051-coding-kill-'))
  const db = openDb(join(home, 'bazilion.db'))
  runMigrations(db)
  try {
    db.raw.run("INSERT INTO teams (id, name, created_at) VALUES ('team', 'Team', 1)")
    // The receipt as agent-host persists it the instant a command starts: state
    // 'running', with the environment snapshot the next turn re-checks.
    const receipt = {
      id: randomUUID(),
      agentId: 'agent-1',
      teamId: 'team',
      turnId: 'turn-1',
      toolCallId: 'call-1',
      input: { command: 'sleep 30', cwd: 'app' },
      environment: {
        revision: 1,
        cwd: 'app',
        rootIdentity: 'root-1',
        posture: 'protected',
        imageId: 'debian:bookworm-slim',
        inputFingerprint: 'fingerprint-1',
      },
      startedAt: Date.now(),
      finishedAt: null,
      state: 'running',
      exitCode: null,
      diagnostic: '',
      truncated: false,
      reason: null,
      sourceBefore: null,
      sourceAfter: null,
    }
    saveCodingCommand(db, receipt as unknown as CodingCommandReceipt)

    // Boot recovery after the kill: the interruption is marked visibly —
    // state, reason, and a cleared input fingerprint so the next turn's
    // applicability check reports stale/unknown instead of resuming blind.
    interruptCodingCommands(db)
    const stored = JSON.parse(
      db.raw.query<{ receipt_json: string }, []>('SELECT receipt_json FROM coding_commands').get()
        ?.receipt_json ?? '{}',
    ) as { state: string; reason: string; finishedAt: number; environment: { inputFingerprint: string | null } }
    expect(stored.state).toBe('interrupted')
    expect(stored.reason).toBe('turn_ended_without_terminal_result')
    expect(stored.finishedAt).toBeGreaterThan(0)
    expect(stored.environment.inputFingerprint).toBeNull()
  } finally {
    db.close()
    rmSync(home, { recursive: true, force: true })
  }
})

// --- Row: Telegram send failure → terminal receipt, source stays open -------

describe('a Telegram send failure stays visible', () => {
  let env: TestEnv
  let send = vi.fn()
  let verify = vi.fn()
  let dispatcher: NotificationDispatcher
  const binding = {
    id: 'destination',
    chatId: -100,
    topicId: 7,
    ownerGrantId: 'owner',
    botDigest: 'digest',
  }
  beforeEach(() => {
    env = makeTestEnv()
    vi.stubEnv('BAZILION_TEAM_POLICY_ENFORCEMENT', 'off')
    createProfile(env.db, env.paths, { id: 'notices', defaultModel: 'lmstudio:test' })
    const agentId = spawnAgent(env.db, env.paths, {
      profileId: 'notices',
      teamId: env.teamId,
    }).id
    env.db.raw.run(
      `INSERT INTO agent_reviews (id, agent_id, status, trigger_kind, next_attempt_at, last_error, created_at, updated_at)
       VALUES ('review', ?, 'failed', 'manual', 1, 'provider exploded', 10, 20)`,
      [agentId],
    )
    const settings = receipts.settings(env.db)
    receipts.saveSettings(
      env.db,
      settings.revision,
      { ...settings, enabled: true, eligibleAfter: 1 },
      binding,
      1,
    )
    send = vi.fn()
    verify = vi.fn()
    dispatcher = new NotificationDispatcher(
      env.db,
      { capture: () => binding, verify, send },
      () => Date.now(),
    )
  })
  afterEach(() => {
    _resetOutboundQueueForTest()
    vi.unstubAllEnvs()
    env.cleanup()
  })

  test('a hard Telegram rejection settles the receipt as failed while the attention item stays open', async () => {
    verify.mockResolvedValue(true)
    send.mockRejectedValue({ error_code: 403, description: 'Forbidden: bot was blocked' })

    await dispatcher.tick()
    await dispatcher.tick()

    const states = env.db.raw
      .query<{ state: string; diagnostic: string | null }, []>(
        "SELECT state, diagnostic FROM notification_receipts WHERE source_kind='review_failure'",
      )
      .all()
    expect(states[0]).toMatchObject({ state: 'failed', diagnostic: 'telegram_rejected' })
    // The push failed; the underlying signal must still be visible.
    const stillOpen = projectAttention(env.db, { state: 'open', limit: 100 }).items
    expect(stillOpen.some((i) => i.kind === 'review_failure' && i.sourceId === 'review')).toBe(true)
  })
})
