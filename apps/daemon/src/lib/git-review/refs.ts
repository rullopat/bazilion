/**
 * Validation for a caller-supplied Git ref, used as a review comparison base.
 *
 * The value is never interpolated into a shell, but it *is* passed to Git as an argument, so it must
 * not be able to look like an option, and it must not be able to name something outside the captured
 * repository. Unusual values are refused rather than repaired — a silently normalized base would
 * make a review point at a different commit than the operator asked for.
 */

/** Conservative shape: a path-like ref with no whitespace, quoting, globbing or leading dash. */
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/

/** A Git object id, sha1 or sha256. */
export function isCommitOid(value: string): boolean {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)
}

export class ReviewRefError extends Error {
  readonly value: string

  constructor(value: string) {
    super('Comparison base must be a plain branch, tag or commit id.')
    this.name = 'ReviewRefError'
    this.value = value
  }
}

/**
 * Return the ref unchanged when it is safe to hand to Git, otherwise throw.
 *
 * Rejected on purpose: anything with a leading `-` (option injection), whitespace or control bytes,
 * `..`/`@{` (revision-range and reflog syntax), `//`, a trailing `/` or `.`, a `.lock` suffix, and
 * anything longer than 255 characters.
 */
export function validateRefName(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255) {
    throw new ReviewRefError(typeof value === 'string' ? value : '')
  }
  if (!REF_PATTERN.test(value)) throw new ReviewRefError(value)
  if (value === '.' || value === '..') throw new ReviewRefError(value)
  if (value.includes('..') || value.includes('@{') || value.includes('//')) {
    throw new ReviewRefError(value)
  }
  if (value.endsWith('/') || value.endsWith('.') || value.endsWith('.lock')) {
    throw new ReviewRefError(value)
  }
  return value
}
