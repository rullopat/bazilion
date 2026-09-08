import { randomUUID } from 'node:crypto'
import type {
  AttentionItem,
  AttentionKind,
  NotificationDestination,
  NotificationReceipt,
  NotificationReceiptList,
  NotificationSettings,
} from '@bazilion/api-types'
import { ATTENTION_KINDS } from '../attention.ts'
import type { BazilionDb } from '../db/client.ts'

export const NOTIFICATION_RECEIPT_LIMIT = 100_000
export interface NotificationBinding extends NotificationDestination {
  ownerGrantId: string
  botDigest: string
}
interface SettingsRow {
  revision: number
  enabled: number
  restorePaused: number
  kindsJson: string
  timezone: string
  quietJson: string | null
  destinationJson: string | null
  eligibleAfter: number | null
  updatedAt: number
}
const settingsFields = `revision, enabled, restore_paused restorePaused, kinds_json kindsJson,
  timezone, quiet_json quietJson, destination_json destinationJson, eligible_after eligibleAfter,
  updated_at updatedAt`
const receiptFields = `id, source_kind sourceKind, source_id sourceId, agent_id agentId,
  team_id teamId, destination_json destinationJson, state, attempts, created_at createdAt,
  updated_at updatedAt, attempted_at attemptedAt, delivered_at deliveredAt,
  telegram_message_id telegramMessageId, diagnostic`
type ReceiptRow = Omit<NotificationReceipt, 'destination'> & { destinationJson: string }
function publicDestination(binding: NotificationBinding): NotificationDestination {
  return { id: binding.id, chatId: binding.chatId, topicId: binding.topicId }
}
function decode(row: ReceiptRow): NotificationReceipt {
  const { destinationJson, ...receipt } = row
  return { ...receipt, destination: publicDestination(JSON.parse(destinationJson)) }
}
export function settings(db: BazilionDb): NotificationSettings {
  const row = db.raw
    .query<SettingsRow, []>(
      `SELECT ${settingsFields} FROM notification_settings WHERE singleton = 1`,
    )
    .get()
  if (!row)
    return {
      revision: 0,
      enabled: false,
      restorePaused: false,
      kinds: [...ATTENTION_KINDS],
      timezone: 'UTC',
      quietHours: null,
      destination: null,
      eligibleAfter: null,
      updatedAt: 0,
    }
  return {
    revision: row.revision,
    enabled: row.enabled === 1,
    restorePaused: row.restorePaused === 1,
    kinds: JSON.parse(row.kindsJson),
    timezone: row.timezone,
    quietHours: row.quietJson === null ? null : JSON.parse(row.quietJson),
    destination:
      row.destinationJson === null ? null : publicDestination(JSON.parse(row.destinationJson)),
    eligibleAfter: row.eligibleAfter,
    updatedAt: row.updatedAt,
  }
}
export function destinationBinding(db: BazilionDb): NotificationBinding | null {
  const row = db.raw
    .query<{ value: string | null }, []>(
      'SELECT destination_json value FROM notification_settings WHERE singleton = 1',
    )
    .get()
  return row?.value ? JSON.parse(row.value) : null
}
export function eligibilityCutoffs(db: BazilionDb): Partial<Record<AttentionKind, number>> {
  const row = db.raw
    .query<{ value: string }, []>(
      'SELECT kind_cutoffs_json value FROM notification_settings WHERE singleton=1',
    )
    .get()
  return row ? JSON.parse(row.value) : {}
}
export function hasRestoredHistory(db: BazilionDb): boolean {
  return (
    db.raw
      .query<{ value: number }, []>(
        'SELECT restore_history_uncertain value FROM notification_settings WHERE singleton=1',
      )
      .get()?.value === 1
  )
}
export function saveSettings(
  db: BazilionDb,
  expectedRevision: number,
  next: Omit<NotificationSettings, 'revision' | 'updatedAt' | 'destination'>,
  binding: NotificationBinding | null,
  now = Date.now(),
): NotificationSettings {
  return db.raw.transaction(() => {
    const current = settings(db)
    if (current.revision !== expectedRevision) throw new Error('notification_settings_conflict')
    if (next.enabled && (!binding || next.restorePaused || next.eligibleAfter === null))
      throw new Error('notification_settings_not_ready')
    const revision = current.revision + 1
    const updatedAt = Math.max(now, current.updatedAt + 1)
    const previousCutoffs = eligibilityCutoffs(db)
    const fresh =
      !current.enabled ||
      current.restorePaused ||
      current.destination?.id !== binding?.id ||
      current.eligibleAfter !== next.eligibleAfter
    const cutoffs = Object.fromEntries(
      next.kinds.map((kind) => [
        kind,
        fresh
          ? (next.eligibleAfter ?? now)
          : current.kinds.includes(kind)
            ? (previousCutoffs[kind] ?? current.eligibleAfter ?? now)
            : now,
      ]),
    )
    db.raw.run(
      `INSERT INTO notification_settings
      (singleton, revision, enabled, restore_paused, kinds_json, kind_cutoffs_json, timezone, quiet_json, destination_json, eligible_after, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(singleton) DO UPDATE SET
      revision=excluded.revision, enabled=excluded.enabled, restore_paused=excluded.restore_paused,
      kinds_json=excluded.kinds_json, kind_cutoffs_json=excluded.kind_cutoffs_json, timezone=excluded.timezone, quiet_json=excluded.quiet_json,
      destination_json=excluded.destination_json, eligible_after=excluded.eligible_after, updated_at=excluded.updated_at`,
      [
        revision,
        Number(next.enabled),
        Number(next.restorePaused),
        JSON.stringify(next.kinds),
        JSON.stringify(cutoffs),
        next.timezone,
        next.quietHours === null ? null : JSON.stringify(next.quietHours),
        binding === null ? null : JSON.stringify(binding),
        next.eligibleAfter,
        updatedAt,
      ],
    )
    if (
      !next.enabled ||
      current.destination?.id !== binding?.id ||
      current.eligibleAfter !== next.eligibleAfter
    )
      db.raw.run(
        `UPDATE notification_receipts SET state='suppressed', diagnostic='settings_changed',
        updated_at=MAX(updated_at + 1, ?) WHERE state='deferred'`,
        [updatedAt],
      )
    for (const kind of current.kinds.filter((kind) => !next.kinds.includes(kind)))
      db.raw.run(
        `UPDATE notification_receipts SET state='suppressed', diagnostic='kind_disabled',
        updated_at=MAX(updated_at+1, ?) WHERE source_kind=? AND state='deferred'`,
        [updatedAt, kind],
      )
    return settings(db)
  })()
}
export function get(db: BazilionDb, id: string): NotificationReceipt | null {
  const row = db.raw
    .query<ReceiptRow, [string]>(`SELECT ${receiptFields} FROM notification_receipts WHERE id=?`)
    .get(id)
  return row ? decode(row) : null
}
export function receiptBinding(db: BazilionDb, id: string): NotificationBinding | null {
  const row = db.raw
    .query<{ value: string }, [string]>(
      'SELECT destination_json value FROM notification_receipts WHERE id=?',
    )
    .get(id)
  return row ? JSON.parse(row.value) : null
}
export function admit(
  db: BazilionDb,
  item: AttentionItem,
  binding: NotificationBinding,
  now = Date.now(),
): NotificationReceipt {
  return db.raw.transaction(() => {
    const existing = db.raw
      .query<ReceiptRow, [string, string, string]>(`SELECT ${receiptFields}
      FROM notification_receipts WHERE source_kind=? AND source_id=? AND destination_id=?`)
      .get(item.kind, item.sourceId, binding.id)
    if (existing) return decode(existing)
    const count =
      db.raw.query<{ n: number }, []>('SELECT COUNT(*) n FROM notification_receipts').get()?.n ?? 0
    if (count >= NOTIFICATION_RECEIPT_LIMIT) throw new Error('notification_capacity_reached')
    const id = randomUUID()
    db.raw.run(
      `INSERT INTO notification_receipts (id, source_kind, source_id, agent_id, team_id,
      destination_id, destination_json, state, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'deferred', ?, ?)`,
      [
        id,
        item.kind,
        item.sourceId,
        item.agentId ?? null,
        item.teamId ?? null,
        binding.id,
        JSON.stringify(binding),
        now,
        now,
      ],
    )
    return get(db, id) as NotificationReceipt
  })()
}
export function list(
  db: BazilionDb,
  options: { cursor?: string; limit?: number; deferredOnly?: boolean } = {},
): NotificationReceiptList {
  if (options.limit !== undefined && !Number.isFinite(options.limit))
    throw new Error('notification_limit_invalid')
  const limit = Math.max(1, Math.min(100, Math.trunc(options.limit ?? 50)))
  const comparison = options.deferredOnly ? '>' : '<'
  const direction = options.deferredOnly ? 'ASC' : 'DESC'
  let after = ''
  const params: (string | number)[] = []
  if (options.cursor) {
    const row = get(db, options.cursor)
    if (!row) throw new Error('notification_cursor_invalid')
    after = ` AND (created_at ${comparison} ? OR (created_at = ? AND id ${comparison} ?))`
    params.push(row.createdAt, row.createdAt, row.id)
  }
  params.push(limit + 1)
  const rows = db.raw
    .query<ReceiptRow, (string | number)[]>(`SELECT ${receiptFields} FROM notification_receipts
    WHERE ${options.deferredOnly ? "state='deferred'" : '1=1'}${after} ORDER BY created_at ${direction}, id ${direction} LIMIT ?`)
    .all(...params)
  const page = rows.slice(0, limit).map(decode)
  return { receipts: page, nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null }
}
export function claim(db: BazilionDb, id: string, now = Date.now()): NotificationReceipt | null {
  db.raw.run(
    `UPDATE notification_receipts SET state='sending', attempts=attempts+1,
    attempted_at=?, updated_at=MAX(updated_at+1, ?), diagnostic=NULL WHERE id=? AND state='deferred'`,
    [now, now, id],
  )
  const item = get(db, id)
  // A caller must own this exact transition; checking state alone could steal another sender's claim.
  const changed = db.raw.query<{ n: number }, []>('SELECT changes() n').get()?.n
  return changed === 1 ? item : null
}
export function settle(
  db: BazilionDb,
  id: string,
  attempt: number,
  state: 'delivered' | 'failed' | 'uncertain' | 'suppressed',
  diagnostic: string | null,
  messageId: number | null = null,
  now = Date.now(),
): boolean {
  if (diagnostic !== null && !/^[a-z0-9_]{1,160}$/.test(diagnostic))
    throw new Error('notification_diagnostic_invalid')
  if (state === 'delivered' && (!Number.isSafeInteger(messageId) || (messageId ?? 0) <= 0))
    throw new Error('notification_receipt_missing')
  db.raw.run(
    `UPDATE notification_receipts SET state=?, diagnostic=?, telegram_message_id=?,
    delivered_at=?, updated_at=MAX(updated_at+1, ?) WHERE id=? AND attempts=? AND state='sending'`,
    [state, diagnostic, messageId, state === 'delivered' ? now : null, now, id, attempt],
  )
  return db.raw.query<{ n: number }, []>('SELECT changes() n').get()?.n === 1
}
export function suppress(db: BazilionDb, id: string, reason: string, now = Date.now()): void {
  if (!/^[a-z0-9_]{1,160}$/.test(reason)) throw new Error('notification_diagnostic_invalid')
  db.raw.run(
    `UPDATE notification_receipts SET state='suppressed', diagnostic=?, updated_at=MAX(updated_at+1, ?)
    WHERE id=? AND state='deferred'`,
    [reason, now, id],
  )
}
export function retry(
  db: BazilionDb,
  id: string,
  expectedUpdatedAt: number,
  acknowledgePossibleDuplicate: boolean,
  now = Date.now(),
): NotificationReceipt {
  return db.raw.transaction(() => {
    const item = get(db, id)
    if (
      !item ||
      item.updatedAt !== expectedUpdatedAt ||
      !['failed', 'uncertain'].includes(item.state)
    )
      throw new Error('notification_retry_conflict')
    if (!acknowledgePossibleDuplicate)
      throw new Error('notification_duplicate_acknowledgement_required')
    db.raw.run(
      `UPDATE notification_receipts SET state='deferred', diagnostic='explicit_retry',
      updated_at=MAX(updated_at+1, ?) WHERE id=?`,
      [now, id],
    )
    return get(db, id) as NotificationReceipt
  })()
}
export function recoverInterrupted(db: BazilionDb, now = Date.now()): void {
  db.raw.run(
    `UPDATE notification_receipts SET state='uncertain', diagnostic='daemon_restarted',
    updated_at=MAX(updated_at+1, ?) WHERE state='sending'`,
    [now],
  )
}
