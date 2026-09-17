import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SnapshotEntry, SourceSnapshot } from '@bazilion/api-types'
import type { BazilionDb } from '../../core/db/client.ts'
import type { Paths } from '../../core/paths.ts'
import type { ReviewPacketRecord } from '../../core/repos/review-packets.ts'
import { getSourceSnapshot } from '../../core/repos/source-snapshots.ts'
import { readRevisionContentAvailability } from '../review/revision.ts'

// BAZ-046: the bytes a publication commits.
//
// A BAZ-042 snapshot stores paths and digests, never content, so the reviewed revision's bytes exist only
// in the working tree — and only while that tree still matches the capture. This module therefore reads
// every path **and verifies it against the digest the capture recorded**. A mismatch is a refusal, never a
// quiet substitution: committing current bytes because they were probably the reviewed ones is exactly the
// claim this project refuses to make.
//
// Nothing here writes anything. It produces the file list the Git commit is built from.

export type ReviewedRevisionFiles =
  | { ok: true; files: Array<{ path: string; content: Buffer }>; removed: string[] }
  | { ok: false; reason: 'revision_unavailable' | 'revision_not_reproducible'; detail: string }

export function readReviewedRevisionFiles(
  db: BazilionDb,
  paths: Paths,
  packet: ReviewPacketRecord,
): ReviewedRevisionFiles {
  const record = getSourceSnapshot(db, packet.teamId, packet.snapshotId)
  if (!record) {
    return {
      ok: false,
      reason: 'revision_unavailable',
      detail: 'the reviewed revision is no longer retained, so its content cannot be committed',
    }
  }
  if (!record.complete) {
    return {
      ok: false,
      reason: 'revision_unavailable',
      detail:
        'the reviewed revision has incomplete coverage, so publishing it would commit a partial change',
    }
  }
  let snapshot: SourceSnapshot
  try {
    snapshot = JSON.parse(record.manifestJson) as SourceSnapshot
  } catch {
    return {
      ok: false,
      reason: 'revision_unavailable',
      detail: 'the reviewed revision manifest could not be read',
    }
  }
  const files: Array<{ path: string; content: Buffer }> = []
  const removed: string[] = []
  for (const entry of snapshot.entries) {
    if (entry.kind === 'deleted') {
      removed.push(entry.path)
      continue
    }
    if (entry.kind !== 'file') {
      return {
        ok: false,
        reason: 'revision_not_reproducible',
        detail: `the reviewed revision records ${entry.path} as ${entry.kind}, so its content cannot be committed`,
      }
    }
    if (!entry.digest) {
      return {
        ok: false,
        reason: 'revision_not_reproducible',
        detail: `the reviewed revision captured no content for ${entry.path}`,
      }
    }
    let content: Buffer
    try {
      content = readFileSync(join(paths.teamDir(packet.teamId), entry.path))
    } catch {
      return {
        ok: false,
        reason: 'revision_not_reproducible',
        detail: `the reviewed content for ${entry.path} can no longer be read`,
      }
    }
    // The capture's digest is a bare sha256 hex, the same value `readWorktreeFile` computed when the
    // snapshot was taken. There is deliberately no prefix: a differently formatted digest would never
    // compare equal, and "no path ever matched" would look exactly like a reproducible revision that
    // simply was not there.
    const digest = createHash('sha256').update(content).digest('hex')
    if (digest !== entry.digest) {
      return {
        ok: false,
        reason: 'revision_not_reproducible',
        detail: `the content of ${entry.path} no longer matches the reviewed revision, so committing it would publish a different change`,
      }
    }
    files.push({ path: entry.path, content })
  }
  if (files.length === 0 && removed.length === 0) {
    return {
      ok: false,
      reason: 'revision_unavailable',
      detail: 'the reviewed revision records no changed content to publish',
    }
  }
  return { ok: true, files, removed }
}

/**
 * Whether the reviewed revision can be committed as reviewed.
 *
 * Answered by the same function the review itself uses, so a publication and a review cannot disagree
 * about whether the tree still holds the revision they are talking about.
 */
export async function reviewedContentIsAvailable(
  db: BazilionDb,
  paths: Paths,
  packet: ReviewPacketRecord,
): Promise<{ contentAvailable: boolean; contentUnavailableReason: string | null }> {
  return readRevisionContentAvailability(db, paths, packet)
}

/** One entry's digest comparison, for diagnostics and tests. */
export function digestEntry(entry: SnapshotEntry, content: Buffer): string {
  return `${entry.digest} vs ${createHash('sha256').update(content).digest('hex')}`
}
