import type { PinnedBase, RepositoryIdentity } from '@bazilion/api-types'
import type { CapturedGit } from '../git/capture.ts'
import type { ReviewIssueCode } from './issue.ts'
import { isCommitOid, ReviewRefError, validateRefName } from './refs.ts'

// Wire shapes are defined once in `@bazilion/api-types`; re-exported so daemon callers keep one
// import path.
export type { PinnedBase, RepositoryIdentity } from '@bazilion/api-types'

// Repository identity and comparison-base resolution for Git change review (BAZ-042).
//
// Every read goes through the shared hardened capture, so no repository config, hook, filter,
// credential helper or external metadata link can influence what is reported here.

export class ReviewBaseError extends Error {
  readonly code: ReviewIssueCode

  constructor(code: ReviewIssueCode, message: string) {
    super(message)
    this.name = 'ReviewBaseError'
    this.code = code
  }
}

const BRANCH_MAX = 4096

/**
 * Read the repository's current identity. An unborn branch reports its name with a null head, so a
 * caller can distinguish "no commits yet" from "detached" and from "not a repository".
 */
export async function readRepositoryIdentity(captured: CapturedGit): Promise<RepositoryIdentity> {
  const branch = await readOrNull(captured, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  const head = await readOrNull(captured, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])
  if (branch !== null && branch.length > BRANCH_MAX) {
    throw new ReviewBaseError('git_output_limit', 'Repository identity exceeds its bound.')
  }
  const resolvedHead = head !== null && isCommitOid(head) ? head : null
  return {
    branch,
    head: resolvedHead,
    headState: resolvedHead ? (branch ? 'branch' : 'detached') : 'unborn',
  }
}

/**
 * Resolve a comparison base to a concrete commit.
 *
 * The ref is validated before it reaches Git, then resolved with `--end-of-options` so it can never
 * be read as an option. Failure is explicit: an invalid shape, an unknown ref, or a ref that does
 * not name a commit each raise `ReviewBaseError` instead of silently falling back to HEAD.
 */
export async function resolveComparisonBase(
  captured: CapturedGit,
  requestedRef = 'HEAD',
): Promise<PinnedBase> {
  let ref: string
  try {
    ref = validateRefName(requestedRef)
  } catch (error) {
    if (error instanceof ReviewRefError) {
      throw new ReviewBaseError('invalid_base', error.message)
    }
    throw error
  }
  const resolved = await readOrNull(captured, [
    'rev-parse',
    '--verify',
    '--quiet',
    '--end-of-options',
    `${ref}^{commit}`,
  ])
  if (resolved === null || !isCommitOid(resolved)) {
    throw new ReviewBaseError(
      'unknown_base',
      `Comparison base "${ref}" does not name a commit in this repository.`,
    )
  }
  return { requestedRef: ref, resolvedOid: resolved }
}

/**
 * Run a read-only command whose non-zero exit is a normal answer (an absent ref, a detached HEAD).
 * Resource failures are rethrown so a timeout or output overflow is never mistaken for "not found".
 */
async function readOrNull(captured: CapturedGit, args: string[]): Promise<string | null> {
  try {
    const output = await captured.runGit(args)
    const trimmed = output.trim()
    return trimmed.length === 0 ? null : trimmed
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (
      code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ||
      code === 'ETIMEDOUT' ||
      (error as { killed?: boolean }).killed
    ) {
      throw new ReviewBaseError('git_output_limit', 'Repository identity exceeds its bound.')
    }
    return null
  }
}
