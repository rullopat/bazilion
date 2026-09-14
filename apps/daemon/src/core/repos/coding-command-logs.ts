import type {
  CodingCommandLogPage,
  CodingCommandLogSearchResult,
  CodingCommandLogView,
} from '@bazilion/api-types'
import { diagnosticTail } from '../../lib/coding-environment/diagnostics.ts'
import type { BazilionDb } from '../db/client.ts'

/**
 * BAZ-041 retained diagnostic evidence. Text lives in the database so the encrypted
 * backup contract carries it, and its original expiry, without a side store.
 */
export const CODING_LOG_BYTES = 2 * 1024 * 1024
/** Home-wide budget across every retained log, enforced by oldest-first eviction. */
export const CODING_LOG_HOME_BYTES = 256 * 1024 * 1024
export const CODING_LOG_TTL_MS = 7 * 86400000
/** Bounded reads and searches; clients page rather than receive a whole tail. */
export const CODING_LOG_PAGE_BYTES = 64 * 1024
export const CODING_LOG_SEARCH_HITS = 50
export const CODING_LOG_SEARCH_SCAN_BYTES = 512 * 1024

/**
 * Who is reading. Retained bytes are private until source-owned egress releases the
 * captured output, so every served page must name its audience rather than defaulting
 * into the permissive direction.
 */
export type CodingLogAudience = 'producer' | 'disclosure'

/** A UTF-8 head with no partial trailing codepoint. */
function headBytes(value: string, limit: number): string {
  const bytes = Buffer.from(value)
  if (bytes.length <= limit) return value
  let end = limit
  while (end < bytes.length && ((bytes[end] ?? 0) & 0xc0) === 0x80) end++
  return bytes.subarray(0, end).toString('utf8')
}

/** True when this audience may see the retained bytes. */
function mayDisclose(view: CodingCommandLogView, audience: CodingLogAudience): boolean {
  return audience === 'producer' || view.releasedAt !== null
}

interface LogRow {
  command_id: string
  team_id: string
  agent_id: string
  turn_id: string
  tool_call_id: string
  state: string
  text: string | null
  byte_length: number
  observed_bytes: number
  redacted: number
  truncated: number
  created_at: number
  expires_at: number
  released_at: number | null
  retired_at: number | null
}

const COLUMNS = `command_id, team_id, agent_id, turn_id, tool_call_id, state, text,
  byte_length, observed_bytes, redacted, truncated, created_at, expires_at, released_at, retired_at`

/** Lazily retire a log whose window passed without a prune run, so reads stay truthful. */
function expiryDue(row: LogRow, now: number): boolean {
  return row.state === 'retained' && row.expires_at <= now
}

/**
 * Text a read may actually serve. A row past its window is expired whether or not a
 * prune has tombstoned it yet, so an un-pruned read must not hand back stale bytes.
 * `null` means "no retained text", which is distinct from an empty output tail.
 */
function liveText(row: LogRow, now: number): string | null {
  return row.state === 'retained' && !expiryDue(row, now) ? row.text : null
}

function availabilityOf(row: LogRow, now: number): CodingCommandLogView['availability'] {
  if (row.state === 'deleted') return 'deleted'
  if (row.state === 'expired' || expiryDue(row, now)) return 'expired'
  return row.truncated === 1 ? 'truncated' : 'available'
}

function toView(row: LogRow, now: number): CodingCommandLogView {
  return {
    commandId: row.command_id,
    teamId: row.team_id,
    agentId: row.agent_id,
    turnId: row.turn_id,
    toolCallId: row.tool_call_id,
    availability: availabilityOf(row, now),
    byteLength: row.byte_length,
    observedBytes: row.observed_bytes,
    redacted: row.redacted === 1,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    releasedAt: row.released_at,
    retiredAt: row.retired_at,
  }
}

function rowFor(db: BazilionDb, commandId: string): LogRow | null {
  return (
    db.raw
      .query<LogRow, [string]>(`SELECT ${COLUMNS} FROM coding_command_logs WHERE command_id = ?`)
      .get(commandId) ?? null
  )
}

/** Availability for a command that never retained a log at all. */
export function unavailableLog(commandId: string): CodingCommandLogView {
  return {
    commandId,
    teamId: '',
    agentId: '',
    turnId: '',
    toolCallId: '',
    availability: 'unavailable',
    byteLength: 0,
    observedBytes: 0,
    redacted: false,
    createdAt: 0,
    expiresAt: 0,
    releasedAt: null,
    retiredAt: null,
  }
}

export function getCodingCommandLog(
  db: BazilionDb,
  commandId: string,
  now = Date.now(),
): CodingCommandLogView {
  const row = rowFor(db, commandId)
  return row ? toView(row, now) : unavailableLog(commandId)
}

/**
 * Retain bounded diagnostic text for a finished command.
 *
 * `observedBytes` is what Bazilion was handed before its own cap. When the producing
 * worker already truncated, that number is a floor and `truncated` stays true, so the
 * view never describes a partial tail as the complete output.
 */
export function saveCodingCommandLog(
  db: BazilionDb,
  input: {
    commandId: string
    teamId: string
    agentId: string
    turnId: string
    toolCallId: string
    diagnostic: string
    observedBytes: number
    redacted: boolean
    truncated: boolean
    now?: number
  },
): CodingCommandLogView {
  const now = input.now ?? Date.now()
  const retained = diagnosticTail(input.diagnostic, CODING_LOG_BYTES)
  const byteLength = Buffer.byteLength(retained.text)
  // Redaction can lengthen bytes ([redacted] longer than a short secret), so keep
  // observed >= retained. Truncation travels as its own explicit flag, but when no
  // redaction ran the byte counts are directly comparable and an observed count that
  // exceeds what we retained is itself proof the producer dropped bytes.
  const observed = Math.max(input.observedBytes, byteLength)
  const truncated =
    retained.truncated || input.truncated || (!input.redacted && input.observedBytes > byteLength)
  db.raw.run(
    `INSERT INTO coding_command_logs (${COLUMNS})
     VALUES (?, ?, ?, ?, ?, 'retained', ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
     ON CONFLICT(command_id) DO UPDATE SET
       state = 'retained',
       text = excluded.text,
       byte_length = excluded.byte_length,
       observed_bytes = excluded.observed_bytes,
       redacted = excluded.redacted,
       truncated = excluded.truncated,
       -- created_at/expires_at stay pinned to the first write: a later update must not
       -- extend the retention window. released_at is deliberately cleared, because
       -- changed output cannot inherit an earlier approval to disclose it.
       released_at = NULL,
       retired_at = NULL`,
    [
      input.commandId,
      input.teamId,
      input.agentId,
      input.turnId,
      input.toolCallId,
      retained.text,
      byteLength,
      observed,
      input.redacted ? 1 : 0,
      truncated ? 1 : 0,
      now,
      now + CODING_LOG_TTL_MS,
    ],
  )
  pruneCodingCommandLogs(db, now)
  return getCodingCommandLog(db, input.commandId, now)
}

export function releaseCodingCommandLog(db: BazilionDb, commandId: string, now = Date.now()): void {
  db.raw.run(
    `UPDATE coding_command_logs SET released_at = COALESCE(released_at, ?)
     WHERE command_id = ? AND state = 'retained'`,
    [now, commandId],
  )
}

/** Deliberate erasure leaves a tombstone so clients can distinguish it from absence. */
export function deleteCodingCommandLog(db: BazilionDb, commandId: string, now = Date.now()): void {
  db.raw.run(
    `UPDATE coding_command_logs SET state = 'deleted', text = NULL, byte_length = 0, retired_at = ?
     WHERE command_id = ? AND state IN ('retained', 'expired')`,
    [now, commandId],
  )
}

/** Bounded page of retained text. Offsets and sizes are UTF-8 bytes, never host paths. */
export function readCodingCommandLog(
  db: BazilionDb,
  commandId: string,
  options: { offset?: number; limit?: number; audience: CodingLogAudience },
  now = Date.now(),
): CodingCommandLogPage | null {
  const view = getCodingCommandLog(db, commandId, now)
  // Null rather than an empty page, so an unauthorized read cannot be mistaken for
  // "this command produced no output".
  if (!mayDisclose(view, options.audience)) return null
  const row = rowFor(db, commandId)
  const limit = Math.min(Math.max(options.limit ?? CODING_LOG_PAGE_BYTES, 1), CODING_LOG_BYTES)
  const text = row ? liveText(row, now) : null
  if (!row || text === null) {
    return {
      commandId,
      availability: view.availability,
      offset: 0,
      text: '',
      hasMore: false,
      byteLength: view.byteLength,
    }
  }
  const bytes = Buffer.from(text)
  // Round both edges forward to a lead byte so a page never starts or ends mid-codepoint.
  let offset = Math.min(Math.max(options.offset ?? 0, 0), bytes.length)
  while (offset < bytes.length && ((bytes[offset] ?? 0) & 0xc0) === 0x80) offset++
  let end = Math.min(offset + limit, bytes.length)
  while (end < bytes.length && ((bytes[end] ?? 0) & 0xc0) === 0x80) end++
  return {
    commandId,
    availability: view.availability,
    offset,
    text: bytes.subarray(offset, end).toString('utf8'),
    hasMore: end < bytes.length,
    byteLength: view.byteLength,
  }
}

/** Bounded literal search over the retained tail. No regex, no host paths. */
export function searchCodingCommandLog(
  db: BazilionDb,
  commandId: string,
  needle: string,
  options: { audience: CodingLogAudience },
  now = Date.now(),
): CodingCommandLogSearchResult | null {
  const view = getCodingCommandLog(db, commandId, now)
  if (!mayDisclose(view, options.audience)) return null
  const row = rowFor(db, commandId)
  const empty: CodingCommandLogSearchResult = {
    commandId,
    availability: view.availability,
    matches: [],
    bounded: false,
  }
  const text = row ? liveText(row, now) : null
  if (text === null || !needle) return empty
  // The scan bound is in bytes, matching its name and the window it documents.
  const scanned = Buffer.byteLength(text) > CODING_LOG_SEARCH_SCAN_BYTES
  const haystack = scanned ? headBytes(text, CODING_LOG_SEARCH_SCAN_BYTES) : text
  const matches: CodingCommandLogSearchResult['matches'] = []
  let from = 0
  let hitLimit = false
  for (;;) {
    if (matches.length === CODING_LOG_SEARCH_HITS) {
      hitLimit = true
      break
    }
    const at = haystack.indexOf(needle, from)
    if (at < 0) break
    const prefix = haystack.slice(0, at)
    matches.push({
      offset: Buffer.byteLength(prefix),
      line: prefix.split('\n').length,
      excerpt: haystack.slice(Math.max(0, at - 40), at + needle.length + 40),
    })
    from = at + needle.length
  }
  return {
    commandId,
    availability: view.availability,
    matches,
    bounded: scanned || hitLimit,
  }
}

/**
 * Expire first, then evict oldest-first to restore the home-wide budget. Logs belonging
 * to a still-running command are never evicted. Retention is best-effort maintenance:
 * a failure here must not turn a completed command into a failed one.
 */
export function pruneCodingCommandLogs(
  db: BazilionDb,
  now = Date.now(),
  budgetBytes = CODING_LOG_HOME_BYTES,
): void {
  db.raw.run(
    `UPDATE coding_command_logs SET state = 'expired', text = NULL, byte_length = 0, retired_at = ?
     WHERE state = 'retained' AND expires_at <= ?`,
    [now, now],
  )
  for (;;) {
    const total =
      db.raw
        .query<{ bytes: number | null }, []>(
          'SELECT SUM(byte_length) AS bytes FROM coding_command_logs',
        )
        .get()?.bytes ?? 0
    if (total <= budgetBytes) return
    const oldest = db.raw
      .query<{ command_id: string }, []>(
        `SELECT command_id FROM coding_command_logs
         WHERE byte_length > 0 AND command_id NOT IN (
           SELECT id FROM coding_commands WHERE state = 'running'
         )
         ORDER BY created_at ASC, command_id ASC LIMIT 1`,
      )
      .get()
    if (!oldest) return
    db.raw.run('DELETE FROM coding_command_logs WHERE command_id = ?', [oldest.command_id])
  }
}
