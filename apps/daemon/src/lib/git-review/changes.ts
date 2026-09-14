import {
  type ContentOmission,
  REVIEW_LIMITS,
  type RepositoryChanges,
  type ReviewChange,
  type ReviewChangeStatus,
  type ReviewIssue,
  type ReviewLimits,
} from '@bazilion/api-types'
import type { CapturedGit } from '../git/capture.ts'
import { type PinnedBase, type RepositoryIdentity, ReviewBaseError } from './identity.ts'
import { reviewScope } from './scope.ts'

// Change inventory and bounded diffs for Git change review (BAZ-042 slice 3).
//
// Two read-only Git invocations describe the same change set: `--raw` carries the status letter,
// modes and rename source, while `--numstat` carries line counts and binary markers. They are
// merged by destination path. Patches are read per file, bounded, and say so when truncated.
//
// The wire shapes live in `@bazilion/api-types`; re-exported so daemon callers keep one path.
export type { ContentOmission, RepositoryChanges, ReviewChange, ReviewChangeStatus, ReviewLimits }
export { REVIEW_LIMITS }

/**
 * List changes between a pinned base and the working tree.
 *
 * `changesSinceBaseline` semantics: staged and unstaged edits are both included, because the
 * operator is reviewing the current state of the tree rather than a commit.
 */
export async function listChanges(
  captured: CapturedGit,
  base: PinnedBase,
  identity: RepositoryIdentity,
  limits: ReviewLimits = REVIEW_LIMITS,
): Promise<RepositoryChanges> {
  const issues: ReviewIssue[] = []
  // Both invocations compare the pinned commit against the *working tree*, so staged and unstaged
  // edits are included together. Omitting the commit here would compare working tree to index and
  // silently hide every staged change.
  const raw = await readDiff(captured, base, [
    '--raw',
    '-M',
    '--no-ext-diff',
    '--no-textconv',
    '-z',
  ])
  const numstat = await readDiff(captured, base, [
    '--numstat',
    '-M',
    '--no-ext-diff',
    '--no-textconv',
    '-z',
  ])

  const counts = parseNumstat(numstat)
  const entries: ReviewChange[] = []
  let excludedTracked = 0
  for (const header of parseRaw(raw)) {
    const scoped = reviewScope(header.path)
    if (!scoped.included) excludedTracked++
    const count = counts.get(header.path) ?? null
    entries.push({
      path: header.path,
      previousPath: header.previousPath,
      status: header.status,
      binary: count?.binary ?? false,
      addedLines: count?.added ?? null,
      deletedLines: count?.deleted ?? null,
      oldMode: header.oldMode,
      newMode: header.newMode,
      patch: null,
      patchTruncated: false,
      // A credential-shaped or Bazilion-owned tracked file may be listed, but never captured.
      contentOmitted: scoped.included ? (count?.binary ? 'binary' : null) : 'excluded',
      excludedReason: scoped.included ? null : scoped.reason,
    })
  }

  const untrackedNames = parseNameList(
    await captured.runGit(['ls-files', '--others', '--exclude-standard', '-z']),
  )
  let excludedUntracked = 0
  for (const path of untrackedNames) {
    const scoped = reviewScope(path)
    if (!scoped.included) {
      // Untracked credential-shaped or Bazilion-owned names are withheld entirely, only counted.
      excludedUntracked++
      continue
    }
    entries.push({
      path,
      previousPath: null,
      status: 'untracked',
      binary: false,
      addedLines: null,
      deletedLines: null,
      oldMode: null,
      newMode: null,
      patch: null,
      patchTruncated: false,
      contentOmitted: 'untracked_not_selected',
      excludedReason: null,
    })
  }

  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const truncated = entries.length > limits.files
  const kept = truncated ? entries.slice(0, limits.files) : entries
  if (truncated) {
    issues.push({
      code: 'file_limit',
      message: `The change list exceeded ${limits.files} files; it is incomplete.`,
    })
  }
  return {
    base,
    identity,
    changes: kept,
    truncated,
    // Counts of what was *not* captured, so an omission is never invisible. Untracked
    // credential-shaped names are counted here but never listed by name.
    withheld: {
      untracked: excludedUntracked,
      excluded: excludedTracked,
      binary: kept.filter((change) => change.binary).length,
      tooLarge: 0,
    },
    issues,
  }
}

/**
 * Read one file's unified diff against the pinned base.
 *
 * Returns a partial patch and `truncated: true` when the diff exceeds the cap, rather than throwing:
 * visible truncation is the honest outcome. Binary and excluded files never receive content.
 */
export async function readChangePatch(
  captured: CapturedGit,
  base: PinnedBase,
  change: ReviewChange,
  patchBytes = REVIEW_LIMITS.patchBytes,
): Promise<{ patch: string | null; truncated: boolean; omitted: ContentOmission | null }> {
  if (change.excludedReason) return { patch: null, truncated: false, omitted: 'excluded' }
  if (change.binary) return { patch: null, truncated: false, omitted: 'binary' }
  if (change.status === 'untracked') {
    return { patch: null, truncated: false, omitted: 'untracked_not_selected' }
  }
  // A deleted file is addressed by its base-side path; everything else by its destination path.
  const target = change.status === 'deleted' ? (change.previousPath ?? change.path) : change.path
  let output: string
  try {
    output = await captured.runGit([
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      '--unified=3',
      '-M',
      base.resolvedOid,
      '--',
      target,
    ])
  } catch (error) {
    if (error instanceof ReviewBaseError) throw error
    return { patch: null, truncated: false, omitted: 'unavailable' }
  }
  if (output.length <= patchBytes) return { patch: output, truncated: false, omitted: null }
  return {
    patch: `${output.slice(0, patchBytes)}\n[truncated: diff exceeds ${patchBytes} bytes]`,
    truncated: true,
    omitted: null,
  }
}

/** Attach bounded patches to a change list, stopping at the total captured-content cap. */
export async function attachPatches(
  captured: CapturedGit,
  report: RepositoryChanges,
  limits: ReviewLimits = REVIEW_LIMITS,
): Promise<RepositoryChanges> {
  let total = 0
  let tooLarge = 0
  const changes: ReviewChange[] = []
  for (const change of report.changes) {
    if (change.contentOmitted && change.contentOmitted !== 'binary') {
      changes.push(change)
      continue
    }
    if (total >= limits.totalBytes) {
      changes.push({ ...change, contentOmitted: 'total_limit' })
      continue
    }
    const read = await readChangePatch(captured, report.base, change, limits.patchBytes)
    const bytes = read.patch ? Buffer.byteLength(read.patch) : 0
    if (bytes > limits.fileBytes && !read.truncated) {
      tooLarge++
      changes.push({ ...change, patch: null, contentOmitted: 'too_large' })
      continue
    }
    total += bytes
    changes.push({
      ...change,
      patch: read.patch,
      patchTruncated: read.truncated,
      contentOmitted: read.omitted,
    })
  }
  return { ...report, changes, withheld: { ...report.withheld, tooLarge } }
}

async function readDiff(captured: CapturedGit, base: PinnedBase, args: string[]): Promise<string> {
  // A diff against the pinned commit; the OID is validated upstream and paths are never user input.
  return captured.runGit(['diff', base.resolvedOid, ...args])
}

function parseNameList(output: string): string[] {
  return output.split('\0').filter((name) => name.length > 0)
}

interface RawHeader {
  path: string
  previousPath: string | null
  status: ReviewChangeStatus
  oldMode: string | null
  newMode: string | null
}

const RAW_HEADER = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])(\d*)$/

function parseRaw(output: string): RawHeader[] {
  const records = output.split('\0')
  const headers: RawHeader[] = []
  for (let i = 0; i < records.length; i++) {
    const record = records[i] ?? ''
    if (record.length === 0) continue
    const match = RAW_HEADER.exec(record)
    if (!match) continue
    const status = statusFrom(match[5] ?? '')
    const paired = status === 'renamed' || status === 'copied'
    const first = records[++i] ?? ''
    if (paired) {
      const second = records[++i] ?? ''
      if (first.length === 0 || second.length === 0) continue
      headers.push({
        path: second,
        previousPath: first,
        status,
        oldMode: match[1] ?? null,
        newMode: match[2] ?? null,
      })
      continue
    }
    if (first.length === 0) continue
    headers.push({
      path: first,
      previousPath: null,
      status,
      oldMode: match[1] ?? null,
      newMode: match[2] ?? null,
    })
  }
  return headers
}

function statusFrom(letter: string): ReviewChangeStatus {
  switch (letter) {
    case 'A':
      return 'added'
    case 'M':
      return 'modified'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'T':
      return 'type_changed'
    case 'U':
      return 'unmerged'
    default:
      return 'unknown'
  }
}

/**
 * Parse `--numstat -z` by destination path.
 *
 * Each record is `added\tdeleted\tpath`; for a rename the path field is empty and the source and
 * destination follow as their own records. Columns are split on the first two tabs only, so a path
 * containing a tab cannot shift the parse.
 */
function parseNumstat(
  output: string,
): Map<string, { added: number | null; deleted: number | null; binary: boolean }> {
  const records = output.split('\0')
  const counts = new Map<
    string,
    { added: number | null; deleted: number | null; binary: boolean }
  >()
  for (let i = 0; i < records.length; i++) {
    const record = records[i] ?? ''
    if (record.length === 0) continue
    const firstTab = record.indexOf('\t')
    if (firstTab < 0) continue
    const secondTab = record.indexOf('\t', firstTab + 1)
    if (secondTab < 0) continue
    const addedField = record.slice(0, firstTab)
    const deletedField = record.slice(firstTab + 1, secondTab)
    let path = record.slice(secondTab + 1)
    if (path.length === 0) {
      // Rename form: source then destination follow as separate NUL-terminated records.
      i++
      path = records[i + 1] ?? ''
      i++
      if (path.length === 0) continue
    }
    const binary = addedField === '-' || deletedField === '-'
    counts.set(path, {
      added: binary ? null : Number.parseInt(addedField, 10),
      deleted: binary ? null : Number.parseInt(deletedField, 10),
      binary,
    })
  }
  return counts
}
