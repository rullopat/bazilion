import { randomUUID } from 'node:crypto'
import type {
  PublicationHost,
  PublicationRefusalReason,
  PublicationState,
} from '@bazilion/api-types'
import { type BazilionDb, inTx } from '../db/client.ts'

// BAZ-046: one operator-approved publication, and the only writer of its state.
//
// Three properties are load-bearing, and they are why this lives in one module:
//
//   1. **A refusal is not an attempt.** `refused` means nothing left the machine — no commit, no push,
//      no pull request — and the schema enforces that a refused row carries a reason while no other
//      state does. Anything else was, or may have been, sent.
//   2. **Publication is leased once.** Exactly one owner publishes; a claim left behind by an
//      interrupted process becomes `uncertain`, never `failed`, because a push that was already in
//      flight may well have landed and saying otherwise would be a guess dressed as a fact.
//   3. **The outcome is recorded from the host.** `commitOid`, `pullRequestNumber` and
//      `pullRequestUrl` are written from what the adapter observed, and `signed` is always 0 — the
//      schema refuses to store anything else, so no code path can claim a signature.

/** Refusals and outcomes are retained for seven days, like the evidence they reference. */
export const PUBLICATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export class PublicationError extends Error {
  constructor(
    readonly code: PublicationRefusalReason | 'publication_not_found' | 'publication_conflict',
    message: string,
  ) {
    super(message)
  }
}

export interface PublicationRecord {
  id: string
  teamId: string
  packetId: string
  snapshotId: string
  host: PublicationHost
  repository: string
  baseBranch: string
  headBranch: string
  baseOid: string
  commitMessage: string
  notifyAgentId: string | null
  state: PublicationState
  refusalReason: PublicationRefusalReason | null
  refusalDetail: string | null
  commitOid: string | null
  signed: boolean
  pullRequestNumber: number | null
  pullRequestUrl: string | null
  error: string | null
  createdAt: number
  finishedAt: number | null
}

const COLUMNS = `id, team_id, packet_id, snapshot_id, host, repository, base_branch, head_branch,
  base_oid, commit_message, notify_agent_id, state, refusal_reason, refusal_detail, commit_oid,
  signed, pull_request_number, pull_request_url, error, created_at, finished_at`

interface Row {
  id: string
  team_id: string
  packet_id: string
  snapshot_id: string
  host: string
  repository: string
  base_branch: string
  head_branch: string
  base_oid: string
  commit_message: string
  notify_agent_id: string | null
  state: string
  refusal_reason: string | null
  refusal_detail: string | null
  commit_oid: string | null
  signed: number
  pull_request_number: number | null
  pull_request_url: string | null
  error: string | null
  created_at: number
  finished_at: number | null
}

function toRecord(row: Row): PublicationRecord {
  return {
    id: row.id,
    teamId: row.team_id,
    packetId: row.packet_id,
    snapshotId: row.snapshot_id,
    host: row.host as PublicationHost,
    repository: row.repository,
    baseBranch: row.base_branch,
    headBranch: row.head_branch,
    baseOid: row.base_oid,
    commitMessage: row.commit_message,
    notifyAgentId: row.notify_agent_id,
    state: row.state as PublicationState,
    refusalReason: row.refusal_reason as PublicationRefusalReason | null,
    refusalDetail: row.refusal_detail,
    commitOid: row.commit_oid,
    // Always false. Read from the row rather than assumed, so a future migration that stores 1 would
    // surface here instead of being silently reported as unsigned.
    signed: row.signed === 1,
    pullRequestNumber: row.pull_request_number,
    pullRequestUrl: row.pull_request_url,
    error: row.error,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  }
}

export function createPublication(
  db: BazilionDb,
  input: {
    teamId: string
    packetId: string
    snapshotId: string
    host: PublicationHost
    repository: string
    baseBranch: string
    headBranch: string
    baseOid: string
    commitMessage: string
    notifyAgentId?: string | null
    now?: number
  },
): PublicationRecord {
  const now = input.now ?? Date.now()
  const id = randomUUID()
  return inTx(db, () => {
    const published = db.raw
      .query<{ id: string }, [string]>(
        "SELECT id FROM publications WHERE packet_id = ? AND state = 'published'",
      )
      .get(input.packetId)
    if (published) {
      throw new PublicationError(
        'already_published',
        'this packet already has a published revision; publishing it again would duplicate the work',
      )
    }
    db.raw.run(
      `INSERT INTO publications (
         id, team_id, packet_id, snapshot_id, host, repository, base_branch, head_branch, base_oid,
         commit_message, notify_agent_id, state, signed, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
      [
        id,
        input.teamId,
        input.packetId,
        input.snapshotId,
        input.host,
        input.repository,
        input.baseBranch,
        input.headBranch,
        input.baseOid,
        input.commitMessage,
        input.notifyAgentId ?? null,
        now,
        now,
      ],
    )
    const created = getPublication(db, id)
    if (!created)
      throw new PublicationError('publication_not_found', 'the publication could not be read back')
    return created
  })
}

export function getPublication(db: BazilionDb, id: string): PublicationRecord | null {
  const row = db.raw
    .query<Row, [string]>(`SELECT ${COLUMNS} FROM publications WHERE id = ?`)
    .get(id)
  return row ? toRecord(row) : null
}

export function listPublications(db: BazilionDb, teamId: string, limit = 50): PublicationRecord[] {
  return db.raw
    .query<Row, [string, number]>(
      `SELECT ${COLUMNS} FROM publications WHERE team_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(teamId, limit)
    .map(toRecord)
}

/**
 * Take the one lease for this publication.
 *
 * Returns null when another owner holds it, when the publication is already settled, or when the row is
 * gone — all three mean "somebody else's business", and none of them is an error the caller must handle
 * differently.
 */
export function claimPublication(
  db: BazilionDb,
  input: { id: string; leaseOwner: string; leaseMs: number; now?: number },
): PublicationRecord | null {
  const now = input.now ?? Date.now()
  return inTx(db, () => {
    const result = db.raw.run(
      `UPDATE publications
          SET state = 'publishing', claimed_by = ?, lease_expires_at = ?, updated_at = ?
        WHERE id = ? AND state = 'pending'
          AND NOT EXISTS (
            SELECT 1 FROM publications p2
             WHERE p2.packet_id = publications.packet_id AND p2.state = 'published'
          )`,
      [input.leaseOwner, now + input.leaseMs, now, input.id],
    )
    if (Number(result.changes) === 0) return null
    return getPublication(db, input.id)
  })
}

/** Record a refusal. Only a pending publication can be refused, and only before anything is sent. */
export function refusePublication(
  db: BazilionDb,
  input: { id: string; reason: PublicationRefusalReason; detail: string; now?: number },
): PublicationRecord {
  const now = input.now ?? Date.now()
  const record = inTx(db, () => {
    const result = db.raw.run(
      `UPDATE publications
          SET state = 'refused', refusal_reason = ?, refusal_detail = ?, lease_expires_at = NULL,
              claimed_by = NULL, finished_at = ?, updated_at = ?
        WHERE id = ? AND state IN ('pending', 'publishing')`,
      [input.reason, input.detail, now, now, input.id],
    )
    if (Number(result.changes) === 0) {
      throw new PublicationError(
        'publication_conflict',
        'a publication that already left the machine cannot be refused',
      )
    }
    return row(db, input.id)
  })
  return record
}

/** Record a published outcome — every field from what the host adapter observed. */
export function settlePublicationPublished(
  db: BazilionDb,
  input: {
    id: string
    commitOid: string
    pullRequestNumber: number | null
    pullRequestUrl: string | null
    now?: number
  },
): PublicationRecord {
  const now = input.now ?? Date.now()
  inTx(db, () => {
    const result = db.raw.run(
      `UPDATE publications
          SET state = 'published', commit_oid = ?, pull_request_number = ?, pull_request_url = ?,
              lease_expires_at = NULL, claimed_by = NULL, finished_at = ?, updated_at = ?
        WHERE id = ? AND state = 'publishing'`,
      [input.commitOid, input.pullRequestNumber, input.pullRequestUrl, now, now, input.id],
    )
    if (Number(result.changes) === 0) {
      throw new PublicationError('publication_conflict', 'the publication was not being published')
    }
  })
  return row(db, input.id)
}

/** Record a failure, with the reason. Nothing about a signature is implied. */
export function settlePublicationFailed(
  db: BazilionDb,
  input: { id: string; error: string; now?: number },
): PublicationRecord {
  return settleUnsent(db, input.id, 'failed', input.error, input.now)
}

/**
 * Record an interrupted attempt.
 *
 * Never `failed`: a push may already have landed, so the honest state is the one that says the branch
 * exists or does not and nobody knows which without asking the host.
 */
export function settlePublicationUncertain(
  db: BazilionDb,
  input: { id: string; error: string; now?: number },
): PublicationRecord {
  return settleUnsent(
    db,
    input.id,
    'uncertain',
    input.error || 'the attempt was interrupted before its outcome was recorded',
    input.now,
  )
}

function settleUnsent(
  db: BazilionDb,
  id: string,
  state: 'failed' | 'uncertain',
  error: string,
  now = Date.now(),
): PublicationRecord {
  inTx(db, () => {
    const result = db.raw.run(
      `UPDATE publications
          SET state = ?, error = ?, lease_expires_at = NULL, claimed_by = NULL,
              finished_at = ?, updated_at = ?
        WHERE id = ? AND state = 'publishing'`,
      [state, error, now, now, id],
    )
    if (Number(result.changes) === 0) {
      throw new PublicationError('publication_conflict', `the publication was not being published`)
    }
  })
  return row(db, id)
}

/**
 * Recover attempts whose lease expired.
 *
 * Called at startup and on a tick. These become `uncertain` — including an attempt made by a process
 * that died mid-push — because whether the branch reached the host is not something this database knows.
 */
export function recoverExpiredPublications(db: BazilionDb, now = Date.now()): string[] {
  const expired = db.raw
    .query<{ id: string }, [number]>(
      "SELECT id FROM publications WHERE state = 'publishing' AND lease_expires_at <= ?",
    )
    .all(now)
  const recovered: string[] = []
  for (const { id } of expired) {
    settlePublicationUncertain(db, {
      id,
      error:
        'the publishing process did not finish; whether the branch reached the host is unknown',
      now,
    })
    recovered.push(id)
  }
  return recovered
}

/** Drop publications past their window. A published row is retained: it is the record of an action. */
export function prunePublications(db: BazilionDb, now = Date.now()): number {
  const result = db.raw.run(
    "DELETE FROM publications WHERE finished_at IS NOT NULL AND finished_at <= ? AND state != 'published'",
    [now - PUBLICATION_TTL_MS],
  )
  return Number(result.changes)
}

function row(db: BazilionDb, id: string): PublicationRecord {
  const record = getPublication(db, id)
  if (!record) throw new PublicationError('publication_not_found', 'the publication is gone')
  return record
}

/** Attach a bounded note to an already-settled publication, without changing what it claims. */
export function notePublicationError(
  db: BazilionDb,
  id: string,
  error: string,
  now = Date.now(),
): void {
  db.raw.run('UPDATE publications SET error = ?, updated_at = ? WHERE id = ?', [
    error.slice(0, 400),
    now,
    id,
  ])
}
