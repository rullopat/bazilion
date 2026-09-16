import type { ReviewPathContent } from '@bazilion/api-types'
import type { BazilionDb } from '../../core/db/client.ts'
import type { Paths } from '../../core/paths.ts'
import type { ReviewPacketRecord } from '../../core/repos/review-packets.ts'
import { getSourceSnapshot } from '../../core/repos/source-snapshots.ts'
import { readTeamReview, requireTeam } from '../git-review/service.ts'

// BAZ-043: reading the *captured* revision, as narrowly as it can honestly be read.
//
// A BAZ-042 snapshot is a manifest — paths, layers, kinds and digests. It is not a copy of the tree. So:
//
//   - The **change list** always comes from the manifest. It is what the review is about, and it survives
//     the working tree moving on.
//   - The **patch** can only come from the working tree, and only while that tree still matches the
//     capture. When it does not, there is no patch to show: a diff of later code is a different change,
//     and presenting it as the reviewed one is the mistake this function exists to avoid.
//
// Nothing here writes anything, and nothing here executes anything.

export type RevisionRead =
  | {
      ok: true
      changes: Array<{ path: string; status: string; previousPath: string | null }>
    }
  | { ok: false; reason: string }

/** The captured revision's changed paths, from the manifest. */
export function readRevisionChanges(
  db: BazilionDb,
  paths: Paths,
  packet: ReviewPacketRecord,
): RevisionRead {
  try {
    requireTeam(db, paths, packet.teamId)
  } catch {
    return { ok: false, reason: 'the Team is not available' }
  }
  const stored = getSourceSnapshot(db, packet.teamId, packet.snapshotId)
  if (!stored) return { ok: false, reason: 'the captured revision is no longer retained' }
  let manifest: {
    complete?: boolean
    entries?: Array<{ path: string; layer: string; kind: string }>
    untrackedIncluded?: string[]
  }
  try {
    manifest = JSON.parse(stored.manifestJson) as typeof manifest
  } catch {
    return { ok: false, reason: 'the captured revision could not be read' }
  }
  const changes = (manifest.entries ?? []).map((entry) => ({
    path: entry.path,
    // The status the *capture* recorded. Deliberately not recomputed from the current tree: that would
    // describe today's code and not the reviewed revision.
    status: describeEntry(entry.layer, entry.kind),
    previousPath: null,
  }))
  // Renames are not in the manifest: it records paths, not movements. Saying nothing is better than
  // inventing a source path.
  return { ok: true, changes }
}

function describeEntry(layer: string, kind: string): string {
  if (kind === 'deleted') return 'deleted'
  if (kind !== 'file') return `not-fingerprinted:${kind}`
  return layer === 'untracked' ? 'untracked' : 'modified'
}

/**
 * One changed path's patch, for a revision whose content is still reproducible.
 *
 * The caller must have established that the working tree matches the capture — see
 * `createReviewCapabilityHost`, which is the only caller and checks that first.
 */
export async function readRevisionPatch(
  db: BazilionDb,
  paths: Paths,
  packet: ReviewPacketRecord,
  path: string,
): Promise<ReviewPathContent> {
  let review
  try {
    review = await readTeamReview(db, paths, packet.teamId, {
      base: packet.baseOid,
      patches: true,
      patchPath: path,
    })
  } catch {
    return {
      path,
      patch: null,
      truncated: false,
      reason: 'the repository could not be read at review time',
    }
  }
  const change = review.changes.changes.find((entry) => entry.path === path)
  if (!change) {
    // The path is in the capture but not in the diff: for an untracked file included by content, there is
    // no tracked diff to show, and saying so is better than an empty patch that reads like "no changes".
    return {
      path,
      patch: null,
      truncated: false,
      reason:
        'the change recorded no diff for this path (it may be untracked content captured by name)',
    }
  }
  if (!change.patch) {
    return {
      path,
      patch: null,
      truncated: false,
      reason: change.contentOmitted
        ? `content was not captured (${change.contentOmitted})`
        : 'the change recorded no content for this path',
    }
  }
  return { path, patch: change.patch, truncated: change.patchTruncated, reason: null }
}
