/**
 * Validation for a caller-supplied Git revision, used as a review comparison base.
 *
 * The value is never interpolated into a shell. It is passed to `git rev-parse` after
 * `--end-of-options`, so ordinary revision syntax (`main`, `v1.2`, `HEAD~1`, `HEAD^`, a commit
 * id) works; only shapes that could read as an option or carry whitespace or control bytes are
 * refused. Upstream and reflog syntax (`@{upstream}`, `@{1}`) cannot resolve: the hardened
 * capture copies no branch configuration or reflogs.
 */

/** A Git object id, sha1 or sha256. */
export function isCommitOid(value: string): boolean {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)
}

export class ReviewRefError extends Error {
  readonly value: string

  constructor(value: string) {
    super('Comparison base must be a branch, tag, commit id or revision such as HEAD~1.')
    this.name = 'ReviewRefError'
    this.value = value
  }
}

/** Return the revision unchanged when it is safe to hand to Git, otherwise throw. */
export function validateRefName(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 255 ||
    value.startsWith('-') ||
    // Spaces and control bytes, including DEL.
    Array.from(value).some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)
  ) {
    throw new ReviewRefError(typeof value === 'string' ? value : '')
  }
  return value
}
