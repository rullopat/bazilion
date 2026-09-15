import type {
  RepositoryChanges,
  RepositoryReviewResponse,
  SnapshotCaptureOrigin,
  SnapshotReference,
  SourceSnapshot,
  SourceSnapshotResponse,
  SourceSnapshotSummary,
} from '@bazilion/api-types'
import type { BazilionDb } from '../../core/db/client.ts'
import type { Paths } from '../../core/paths.ts'
import {
  getSourceSnapshot,
  listSourceSnapshots,
  type SourceSnapshotRecord,
  saveSourceSnapshot,
} from '../../core/repos/source-snapshots.ts'
import * as teamRepo from '../../core/repos/teams.ts'
import { type CapturedGit, captureRepositoryGit, findRepositoryRoot } from '../git/capture.ts'
import { ContextDirectory, ContextReadError } from '../repository-context/files.ts'
import { attachPatches, listChanges, type ReviewLimits } from './changes.ts'
import { ReviewBaseError, readRepositoryIdentity, resolveComparisonBase } from './identity.ts'
import { captureSourceSnapshot, compareSnapshots, snapshotReference } from './snapshot.ts'

// Daemon-side Git review operations (BAZ-042 slice 5).
//
// Everything here is read-only. Inspection never stages, commits, checks out, mutates the index or
// runs a repository-configured helper; the shared capture in `lib/git/capture.ts` is the only path
// to Git and applies those protections itself.

/** A review cannot be produced for this Team or repository layout. */
export class ReviewUnavailableError extends Error {
  readonly code: 'not_repository' | 'unsupported_layout' | 'team_not_found'

  constructor(code: 'not_repository' | 'unsupported_layout' | 'team_not_found', message: string) {
    super(message)
    this.name = 'ReviewUnavailableError'
    this.code = code
  }
}

function requireTeam(db: BazilionDb, paths: Paths, teamId: string): { id: string; path: string } {
  const team = teamRepo.get(db, teamId, paths)
  if (!team) throw new ReviewUnavailableError('team_not_found', 'Team not found.')
  return { id: team.id, path: team.path }
}

/**
 * Open a Team workspace, capture its Git metadata and run `fn` inside that capture.
 *
 * The workspace is reached through an fd-pinned `ContextDirectory` (never a path), and everything is
 * released afterwards even when the work fails.
 */
async function withRepository<T>(
  teamDir: string,
  fn: (captured: CapturedGit) => Promise<T>,
): Promise<T> {
  let directory: ContextDirectory
  try {
    directory = new ContextDirectory(teamDir)
  } catch (error) {
    throw new ReviewUnavailableError(
      'unsupported_layout',
      error instanceof ContextReadError
        ? `This Team's workspace cannot be inspected safely (${error.code}).`
        : 'This Team workspace cannot be inspected.',
    )
  }
  try {
    const root = findRepositoryRoot([directory])
    if (!root) {
      throw new ReviewUnavailableError('not_repository', 'This Team is not a Git repository.')
    }
    let captured: CapturedGit
    try {
      captured = await captureRepositoryGit(root)
    } catch (error) {
      throw new ReviewUnavailableError(
        'unsupported_layout',
        error instanceof ContextReadError
          ? `This repository layout is not supported (${error.code}).`
          : 'This repository cannot be inspected.',
      )
    }
    try {
      return await fn(captured)
    } finally {
      captured.cleanup()
    }
  } finally {
    directory.close()
  }
}

/**
 * "Changes since baseline" for a Team, against a pinned base.
 *
 * Patches are opt-in: the change list alone is cheap, and a caller that wants only the file list
 * should not pay for (or receive) the content.
 */
export async function readTeamReview(
  db: BazilionDb,
  paths: Paths,
  teamId: string,
  input: { base?: string; patches?: boolean; patchPath?: string; limits?: ReviewLimits } = {},
): Promise<RepositoryReviewResponse> {
  const team = requireTeam(db, paths, teamId)
  const changes: RepositoryChanges = await withRepository(team.path, async (captured) => {
    const base = await resolveComparisonBase(captured, input.base ?? 'HEAD')
    const identity = await readRepositoryIdentity(captured)
    const listed = await listChanges(captured, base, identity, input.limits)
    return input.patches ? attachPatches(captured, listed, input.limits, input.patchPath) : listed
  })
  return { teamId: team.id, changes }
}

export interface CaptureSnapshotRequest {
  base?: string
  includeUntracked?: readonly string[]
  capturedBy: SnapshotCaptureOrigin
  agentId?: string | null
  turnId?: string | null
  toolCallId?: string | null
  limits?: ReviewLimits
}

/**
 * Capture and persist a bounded source snapshot for a Team.
 *
 * Persisting is best-effort in one direction only: the snapshot document is always returned, so a
 * caller can use it immediately, while the stored row is what makes the reference resolvable later.
 */
export async function captureTeamSnapshot(
  db: BazilionDb,
  paths: Paths,
  teamId: string,
  input: CaptureSnapshotRequest,
): Promise<SourceSnapshotResponse> {
  const team = requireTeam(db, paths, teamId)
  const snapshot = await withRepository(team.path, async (captured) => {
    const base = await resolveComparisonBase(captured, input.base ?? 'HEAD')
    const identity = await readRepositoryIdentity(captured)
    return captureSourceSnapshot(captured, base, identity, {
      ...(input.includeUntracked ? { includeUntracked: input.includeUntracked } : {}),
      ...(input.limits ? { limits: input.limits } : {}),
    })
  })
  saveSourceSnapshot(db, {
    snapshotId: snapshot.id,
    teamId: team.id,
    capturedBy: input.capturedBy,
    agentId: input.agentId ?? null,
    turnId: input.turnId ?? null,
    toolCallId: input.toolCallId ?? null,
    complete: snapshot.complete,
    head: snapshot.head,
    baseOid: snapshot.base.resolvedOid,
    entryCount: snapshot.entries.length,
    capturedContentBytes: snapshot.entries.reduce((total, entry) => total + (entry.bytes ?? 0), 0),
    manifestJson: JSON.stringify(snapshot),
  })
  return { snapshot, reference: snapshotReference(snapshot) }
}

/**
 * Whether a stored snapshot still describes the current source state (BAZ-042 criterion 4).
 *
 * Deliberately three-valued and conservative. Comparing whole-tree states establishes that the
 * source *changed*, never that the change was relevant to what was tested — relevance needs coverage
 * information Bazilion does not have, so this must never be rendered as a pass or a badge.
 */
export interface SnapshotApplicability {
  comparison: 'identical' | 'changed' | 'unknown'
  reason:
    | 'source_unchanged'
    | 'source_changed'
    | 'no_snapshot'
    | 'incomplete_snapshot'
    | 'capture_unavailable'
  currentSnapshot: SnapshotReference | null
}

export async function readSnapshotApplicability(
  db: BazilionDb,
  paths: Paths,
  teamId: string,
  snapshotId: string,
): Promise<SnapshotApplicability> {
  const team = requireTeam(db, paths, teamId)
  const record = getSourceSnapshot(db, team.id, snapshotId)
  // Unknown covers both "never captured" and "past its window": neither can support a claim.
  if (!record) return { comparison: 'unknown', reason: 'no_snapshot', currentSnapshot: null }
  let stored: SourceSnapshot
  try {
    stored = JSON.parse(record.manifestJson) as SourceSnapshot
  } catch {
    return { comparison: 'unknown', reason: 'no_snapshot', currentSnapshot: null }
  }
  if (!stored.complete) {
    return { comparison: 'unknown', reason: 'incomplete_snapshot', currentSnapshot: null }
  }
  let current: SourceSnapshot
  try {
    current = await withRepository(team.path, async (captured) => {
      const base = await resolveComparisonBase(captured, 'HEAD')
      const identity = await readRepositoryIdentity(captured)
      // Not persisted: checking applicability must not create evidence of its own.
      return captureSourceSnapshot(captured, base, identity, {
        includeUntracked: stored.untrackedIncluded,
      })
    })
  } catch {
    return { comparison: 'unknown', reason: 'capture_unavailable', currentSnapshot: null }
  }
  const comparison = compareSnapshots(stored, current)
  return {
    comparison,
    reason: comparison === 'identical' ? 'source_unchanged' : 'source_changed',
    currentSnapshot: snapshotReference(current),
  }
}

export function listTeamSnapshots(
  db: BazilionDb,
  paths: Paths,
  teamId: string,
  limit = 50,
): SourceSnapshotSummary[] {
  const team = requireTeam(db, paths, teamId)
  return listSourceSnapshots(db, team.id, limit).map(toSummary)
}

/** Read a stored snapshot document, or null when the id is unknown or past its window. */
export function readTeamSnapshot(
  db: BazilionDb,
  paths: Paths,
  teamId: string,
  snapshotId: string,
): SourceSnapshot | null {
  const team = requireTeam(db, paths, teamId)
  const record = getSourceSnapshot(db, team.id, snapshotId)
  if (!record) return null
  try {
    return JSON.parse(record.manifestJson) as SourceSnapshot
  } catch {
    return null
  }
}

function toSummary(record: SourceSnapshotRecord): SourceSnapshotSummary {
  return {
    snapshotId: record.snapshotId,
    teamId: record.teamId,
    capturedBy: record.capturedBy,
    agentId: record.agentId,
    turnId: record.turnId,
    toolCallId: record.toolCallId,
    complete: record.complete,
    head: record.head,
    baseOid: record.baseOid,
    entryCount: record.entryCount,
    capturedContentBytes: record.capturedContentBytes,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  }
}

export { ReviewBaseError }
