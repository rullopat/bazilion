import type { BazilionDb } from '../db/client.ts'

// BAZ-042: bounded source snapshots as durable code evidence.
//
// Narrow by design. A snapshot is a bounded manifest of paths and digests, not file content, and it
// is not another conversation store or a general runs/events layer. Rows are Team-scoped so a
// reference is meaningless outside the Team that captured it, and Team deletion cascades.

/** Snapshots and review metadata are retained for seven days. */
export const SOURCE_SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Where a capture came from. An operator capture has no turn, and says so rather than faking one. */
export type SnapshotCaptureOrigin = 'agent' | 'operator'

export interface SourceSnapshotInput {
  snapshotId: string
  teamId: string
  capturedBy: SnapshotCaptureOrigin
  agentId: string | null
  turnId: string | null
  toolCallId: string | null
  complete: boolean
  head: string | null
  baseOid: string
  entryCount: number
  capturedContentBytes: number
  manifestJson: string
  now?: number
}

export interface SourceSnapshotRecord {
  snapshotId: string
  teamId: string
  capturedBy: SnapshotCaptureOrigin
  agentId: string | null
  turnId: string | null
  toolCallId: string | null
  complete: boolean
  head: string | null
  baseOid: string
  entryCount: number
  capturedContentBytes: number
  manifestJson: string
  createdAt: number
  expiresAt: number
}

interface Row {
  snapshot_id: string
  team_id: string
  captured_by: string
  agent_id: string | null
  turn_id: string | null
  tool_call_id: string | null
  complete: number
  head: string | null
  base_oid: string
  entry_count: number
  captured_content_bytes: number
  manifest_json: string
  created_at: number
  expires_at: number
}

const COLUMNS =
  'snapshot_id, team_id, captured_by, agent_id, turn_id, tool_call_id, complete, head, base_oid, ' +
  'entry_count, captured_content_bytes, manifest_json, created_at, expires_at'

function toRecord(row: Row): SourceSnapshotRecord {
  return {
    snapshotId: row.snapshot_id,
    teamId: row.team_id,
    capturedBy: row.captured_by === 'agent' ? 'agent' : 'operator',
    agentId: row.agent_id,
    turnId: row.turn_id,
    toolCallId: row.tool_call_id,
    complete: row.complete === 1,
    head: row.head,
    baseOid: row.base_oid,
    entryCount: row.entry_count,
    capturedContentBytes: row.captured_content_bytes,
    manifestJson: row.manifest_json,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }
}

/**
 * Persist a snapshot.
 *
 * The id is content-addressed, so re-capturing an identical state conflicts on the same row and
 * nothing is written: the first capture's provenance and its original `expires_at` survive, because
 * a later capture must not extend a retention window.
 */
export function saveSourceSnapshot(db: BazilionDb, input: SourceSnapshotInput): void {
  const now = input.now ?? Date.now()
  db.raw.run(
    `INSERT INTO source_snapshots (${COLUMNS})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(snapshot_id, team_id) DO NOTHING`,
    [
      input.snapshotId,
      input.teamId,
      input.capturedBy,
      input.agentId,
      input.turnId,
      input.toolCallId,
      input.complete ? 1 : 0,
      input.head,
      input.baseOid,
      input.entryCount,
      input.capturedContentBytes,
      input.manifestJson,
      now,
      now + SOURCE_SNAPSHOT_TTL_MS,
    ],
  )
  pruneSourceSnapshots(db, now)
}

/**
 * Read a snapshot inside one Team.
 *
 * Returns null when the id is unknown *or* past its window: both mean the same thing to a caller —
 * applicability cannot be established — so an expired snapshot is never served as evidence.
 */
export function getSourceSnapshot(
  db: BazilionDb,
  teamId: string,
  snapshotId: string,
  now = Date.now(),
): SourceSnapshotRecord | null {
  const row = db.raw
    .query<Row, [string, string, number]>(
      `SELECT ${COLUMNS} FROM source_snapshots
       WHERE team_id = ? AND snapshot_id = ? AND expires_at > ?`,
    )
    .get(teamId, snapshotId, now)
  return row ? toRecord(row) : null
}

/** Drop every snapshot past its window, including rows whose Team still exists. */
export function pruneSourceSnapshots(db: BazilionDb, now = Date.now()): number {
  const result = db.raw.run('DELETE FROM source_snapshots WHERE expires_at <= ?', [now])
  return Number(result.changes)
}

/** Team-scoped listing, newest first, for review surfaces. */
export function listSourceSnapshots(
  db: BazilionDb,
  teamId: string,
  limit = 50,
  now = Date.now(),
): SourceSnapshotRecord[] {
  return db.raw
    .query<Row, [string, number, number]>(
      `SELECT ${COLUMNS} FROM source_snapshots
       WHERE team_id = ? AND expires_at > ?
       ORDER BY created_at DESC, snapshot_id LIMIT ?`,
    )
    .all(teamId, now, limit)
    .map(toRecord)
}
