import type { CapturedGit } from '../git/capture.ts'
import { type ContextDirectory, hash, relativeParts } from '../repository-context/files.ts'
import { listChanges, REVIEW_LIMITS, type ReviewLimits } from './changes.ts'
import type { PinnedBase, RepositoryIdentity } from './identity.ts'
import type { ReviewIssue, ReviewIssueCode } from './issue.ts'
import { reviewScope, type ScopeReason } from './scope.ts'

// Source snapshots for Git change review (BAZ-042 slice 4).
//
// A snapshot is bounded *code evidence*: HEAD, the index, the dirty tracked bytes and any explicitly
// included untracked content. It is not another conversation store and not a runs/events layer.
//
// HEAD alone never identifies a dirty tree, so the manifest covers four layers:
//   HEAD (covers all committed content) + a digest of the index entries (staged, content-addressed
//   by blob id) + content digests of every path that differs from the pinned base + digests of the
//   untracked paths the caller explicitly selected.
//
// Modification times are deliberately never used: they cannot distinguish a real edit from a touch.

export type SnapshotEntryLayer = 'worktree' | 'untracked'

export type SnapshotEntryKind = 'file' | 'deleted' | 'not_regular' | 'too_large' | 'unstable'

export interface SnapshotEntry {
  path: string
  layer: SnapshotEntryLayer
  kind: SnapshotEntryKind
  /** sha256 of the captured bytes, or null when no content could be read. */
  digest: string | null
  bytes: number | null
}

export interface SourceSnapshot {
  /**
   * Content-addressed id over everything that identifies this state. Identical trees produce the
   * same id, and `capturedAt` is deliberately excluded so the id never depends on when it was taken.
   * `complete` is included, so an incomplete manifest can never share an id with a complete one.
   */
  id: string
  capturedAt: number
  /** False whenever any entry could not be fingerprinted; applicability must then be unknown. */
  complete: boolean
  identity: RepositoryIdentity
  base: PinnedBase
  head: string | null
  /** Digest of the staged entries (mode/oid/stage/path), or null when the index is unreadable. */
  indexDigest: string | null
  indexEntries: number
  entries: SnapshotEntry[]
  /** Untracked paths the caller explicitly asked to include. */
  untrackedIncluded: string[]
  /** Paths refused by scope policy, recorded so an omission is never invisible. */
  exclusions: { path: string; reason: ScopeReason }[]
  withheld: { excluded: number; tooLarge: number; notRegular: number; unstable: number }
  limits: ReviewLimits
  issues: ReviewIssue[]
}

/** The immutable reference BAZ-041 receipts and BAZ-043 handoff carry. */
export interface SnapshotReference {
  id: string
  complete: boolean
  capturedAt: number
}

export function snapshotReference(snapshot: SourceSnapshot): SnapshotReference {
  return { id: snapshot.id, complete: snapshot.complete, capturedAt: snapshot.capturedAt }
}

/**
 * Applicability of one snapshot against another, for a receipt or a verification handoff.
 *
 * `unknown` is the honest answer whenever either side is incomplete — a snapshot that could not
 * fingerprint everything must never be reported as unchanged.
 */
export type SnapshotComparison = 'identical' | 'changed' | 'unknown'

export function compareSnapshots(
  before: SourceSnapshot,
  after: SourceSnapshot,
): SnapshotComparison {
  if (!before.complete || !after.complete) return 'unknown'
  return before.id === after.id ? 'identical' : 'changed'
}

export interface CaptureSnapshotInput {
  /** Untracked paths to include by content. Names only; nothing is included implicitly. */
  includeUntracked?: readonly string[]
  limits?: ReviewLimits
}

type WorktreeRead =
  | { kind: 'file'; digest: string; bytes: number }
  | { kind: 'deleted' }
  | { kind: 'not_regular' }
  | { kind: 'too_large' }
  | { kind: 'unstable' }

/**
 * Capture a bounded, immutable snapshot of the working tree.
 *
 * Never throws for content problems: anything that cannot be fingerprinted makes the snapshot
 * incomplete and is recorded, because "incomplete" and "exact" must not be distinguishable only by
 * reading prose.
 */
export async function captureSourceSnapshot(
  captured: CapturedGit,
  base: PinnedBase,
  identity: RepositoryIdentity,
  input: CaptureSnapshotInput = {},
): Promise<SourceSnapshot> {
  const limits = input.limits ?? REVIEW_LIMITS
  const issues: ReviewIssue[] = []
  const withheld = { excluded: 0, tooLarge: 0, notRegular: 0, unstable: 0 }
  let incomplete = false
  const fail = (code: ReviewIssueCode, message: string): void => {
    incomplete = true
    issues.push({ code, message })
  }

  // --- index layer -----------------------------------------------------------------------------
  const index = await readIndexDigest(captured)
  if (index === null) fail('unstable', 'The index could not be read at snapshot time.')
  if (index && index.entries > limits.files)
    fail(
      'file_limit',
      `The index holds more than ${limits.files} entries; the snapshot is incomplete.`,
    )

  // --- worktree layer: everything that differs from the pinned base ----------------------------
  const changes = await listChanges(captured, base, identity, limits)
  if (changes.truncated)
    fail('file_limit', 'The change list was truncated; the snapshot is incomplete.')
  const entries: SnapshotEntry[] = []
  let totalBytes = 0
  for (const change of changes.changes) {
    if (change.status === 'untracked') continue
    if (change.path === '.git') continue
    if (change.status === 'deleted') {
      entries.push({
        path: change.path,
        layer: 'worktree',
        kind: 'deleted',
        digest: null,
        bytes: null,
      })
      continue
    }
    const read = readWorktreeFile(captured.root, change.path, limits.fileBytes)
    switch (read.kind) {
      case 'file':
        totalBytes += read.bytes
        if (totalBytes > limits.totalBytes) {
          fail(
            'file_limit',
            `Captured content exceeded ${limits.totalBytes} bytes; the snapshot is incomplete.`,
          )
          entries.push({
            path: change.path,
            layer: 'worktree',
            kind: 'too_large',
            digest: null,
            bytes: read.bytes,
          })
          break
        }
        entries.push({
          path: change.path,
          layer: 'worktree',
          kind: 'file',
          digest: read.digest,
          bytes: read.bytes,
        })
        break
      case 'deleted':
        entries.push({
          path: change.path,
          layer: 'worktree',
          kind: 'deleted',
          digest: null,
          bytes: null,
        })
        break
      case 'too_large':
        withheld.tooLarge++
        fail(
          'file_limit',
          `A changed file exceeds ${limits.fileBytes} bytes; the snapshot is incomplete.`,
        )
        entries.push({
          path: change.path,
          layer: 'worktree',
          kind: 'too_large',
          digest: null,
          bytes: null,
        })
        break
      case 'not_regular':
        withheld.notRegular++
        fail(
          'unstable',
          'A changed path is not a regular file (symlink or special); its content cannot be fingerprinted.',
        )
        entries.push({
          path: change.path,
          layer: 'worktree',
          kind: 'not_regular',
          digest: null,
          bytes: null,
        })
        break
      case 'unstable':
        withheld.unstable++
        fail(
          'unstable',
          'A changed file changed while it was being read; the snapshot is incomplete.',
        )
        entries.push({
          path: change.path,
          layer: 'worktree',
          kind: 'unstable',
          digest: null,
          bytes: null,
        })
        break
    }
  }

  // --- explicitly included untracked layer -----------------------------------------------------
  const untrackedIncluded: string[] = []
  const exclusions: { path: string; reason: ScopeReason }[] = []
  for (const path of [...new Set(input.includeUntracked ?? [])].sort()) {
    const scoped = reviewScope(path)
    if (!scoped.included) {
      exclusions.push({ path, reason: scoped.reason })
      withheld.excluded++
      continue
    }
    if (totalBytes >= limits.totalBytes) {
      fail(
        'file_limit',
        `Captured content exceeded ${limits.totalBytes} bytes; the snapshot is incomplete.`,
      )
      continue
    }
    const read = readWorktreeFile(captured.root, path, limits.fileBytes)
    if (read.kind === 'file') {
      totalBytes += read.bytes
      untrackedIncluded.push(path)
      entries.push({
        path,
        layer: 'untracked',
        kind: 'file',
        digest: read.digest,
        bytes: read.bytes,
      })
      continue
    }
    if (read.kind === 'too_large') withheld.tooLarge++
    else if (read.kind === 'not_regular') withheld.notRegular++
    else withheld.unstable++
    fail(
      read.kind === 'too_large' ? 'file_limit' : 'unstable',
      `Included untracked path "${path}" could not be fingerprinted (${read.kind}); the snapshot is incomplete.`,
    )
    entries.push({
      path,
      layer: 'untracked',
      kind:
        read.kind === 'too_large'
          ? 'too_large'
          : read.kind === 'not_regular'
            ? 'not_regular'
            : 'unstable',
      digest: null,
      bytes: null,
    })
  }

  // --- coherence re-check ----------------------------------------------------------------------
  // The index is re-read after all content work. A change here means another writer touched the
  // repository while the snapshot was being taken. This detects a moved index, not a transient edit
  // that was reverted before the check, so an exact claim still carries that stated limit.
  const recheck = await readIndexDigest(captured)
  if (index && recheck && index.digest !== recheck.digest) {
    fail(
      'unstable',
      'The index changed while the snapshot was being taken; the snapshot is incomplete.',
    )
  }

  entries.sort((a, b) =>
    a.layer === b.layer
      ? a.path < b.path
        ? -1
        : a.path > b.path
          ? 1
          : 0
      : a.layer < b.layer
        ? -1
        : 1,
  )
  exclusions.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const canonical = {
    identity,
    base: base.resolvedOid,
    head: index?.head ?? null,
    indexDigest: index?.digest ?? null,
    indexEntries: index?.entries ?? 0,
    entries: entries.map((entry) => [
      entry.layer,
      entry.path,
      entry.kind,
      entry.digest,
      entry.bytes,
    ]),
    untrackedIncluded,
    exclusions: exclusions.map((exclusion) => [exclusion.path, exclusion.reason]),
    withheld,
    limits,
    complete: !incomplete,
  }
  return {
    id: hash(JSON.stringify(canonical)),
    capturedAt: Date.now(),
    complete: !incomplete,
    identity,
    base,
    head: canonical.head,
    indexDigest: canonical.indexDigest,
    indexEntries: canonical.indexEntries,
    entries,
    untrackedIncluded,
    exclusions,
    withheld,
    limits,
    issues,
  }
}

/**
 * Digest the staged index.
 *
 * Blob ids are content-addressed, so this identifies the staged bytes exactly without reading any
 * file content.
 */
async function readIndexDigest(
  captured: CapturedGit,
): Promise<{ digest: string; entries: number; head: string | null } | null> {
  try {
    const output = await captured.runGit(['ls-files', '--stage', '-z'])
    const lines: string[] = []
    let entries = 0
    for (const record of output.split('\0')) {
      if (record.length === 0) continue
      // "<mode> <oid> <stage>\t<path>"
      const tab = record.indexOf('\t')
      if (tab < 0) continue
      const meta = record.slice(0, tab)
      const path = record.slice(tab + 1)
      if (path.length === 0) continue
      entries++
      lines.push(`${meta} ${path}`)
    }
    lines.sort()
    const head = (
      await captured.runGit(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])
    ).trim()
    return {
      digest: hash(lines.join('\n')),
      entries,
      head: /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(head) ? head : null,
    }
  } catch {
    return null
  }
}

/**
 * Read one repository-relative file through the fd-pinned directory.
 *
 * Paths are validated rather than normalized, symlinks and special files are refused instead of
 * followed, and an oversized file is reported as such rather than silently truncated into a digest
 * that would not identify the real content.
 */
function readWorktreeFile(root: ContextDirectory, path: string, maxBytes: number): WorktreeRead {
  let parts: string[]
  try {
    parts = relativeParts(path)
  } catch {
    return { kind: 'not_regular' }
  }
  if (parts.length === 0) return { kind: 'not_regular' }
  let current: ContextDirectory = root
  try {
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] as string
      const entry = current.entry(part)
      if (!entry) return { kind: 'deleted' }
      if (entry.isSymbolicLink()) return { kind: 'not_regular' }
      const last = i === parts.length - 1
      if (last) {
        if (!entry.isFile()) return { kind: 'not_regular' }
        if (entry.size > maxBytes) return { kind: 'too_large' }
        const bytes = current.read(part, maxBytes)
        if (!bytes) return { kind: 'unstable' }
        return { kind: 'file', digest: hash(bytes), bytes: bytes.length }
      }
      if (!entry.isDirectory()) return { kind: 'not_regular' }
      current = current.directory(part)
    }
  } catch {
    return { kind: 'unstable' }
  }
  return { kind: 'not_regular' }
}
