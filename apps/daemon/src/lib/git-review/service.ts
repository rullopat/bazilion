import type { RepositoryChanges, RepositoryReviewResponse, ReviewLimits } from '@bazilion/api-types'
import type { BazilionDb } from '../../core/db/client.ts'
import { DomainError } from '../../core/errors.ts'
import type { Paths } from '../../core/paths.ts'
import * as teamRepo from '../../core/repos/teams.ts'
import { type CapturedGit, captureRepositoryGit, findRepositoryRoot } from '../git/capture.ts'
import { ContextDirectory, ContextReadError } from '../git/context-directory.ts'
import { attachPatches, listChanges } from './changes.ts'
import { readRepositoryIdentity, resolveComparisonBase } from './identity.ts'

// Daemon-side Git review operations (BAZ-042).
//
// Everything here is read-only. Inspection never stages, commits, checks out, mutates the index or
// runs a repository-configured helper; the shared capture in `lib/git/capture.ts` is the only path
// to Git and applies those protections itself.

/** A review cannot be produced for this Team or repository layout. */
class ReviewUnavailableError extends DomainError {
  constructor(code: 'not_repository' | 'unsupported_layout', message: string) {
    super(409, message, code)
  }
}

export function requireTeam(
  db: BazilionDb,
  paths: Paths,
  teamId: string,
): { id: string; path: string } {
  const team = teamRepo.get(db, teamId, paths)
  if (!team) throw new DomainError(404, 'Team not found.')
  return { id: team.id, path: team.path }
}

/**
 * Open a Team workspace, capture its Git metadata and run `fn` inside that capture.
 *
 * The workspace is reached through an fd-pinned `ContextDirectory` (never a path), and everything is
 * released afterwards even when the work fails.
 */
export async function withRepository<T>(
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
