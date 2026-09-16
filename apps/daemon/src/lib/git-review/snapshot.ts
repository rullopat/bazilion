import {
  REVIEW_LIMITS,
  type RepositoryIdentity,
  type ReviewIssue,
  type ReviewIssueCode,
  type ReviewLimits,
  type ReviewScopeReason,
  type SnapshotComparison,
  type SnapshotEntry,
  type SnapshotEntryKind,
  type SnapshotEntryLayer,
  type SnapshotReference,
  type SourceSnapshot,
} from '@bazilion/api-types'
import type { CapturedGit } from '../git/capture.ts'
import { type ContextDirectory, hash, relativeParts } from '../repository-context/files.ts'
import { listChanges } from './changes.ts'
import type { PinnedBase } from './identity.ts'
import { reviewScope } from './scope.ts'

// Wire shapes live in `@bazilion/api-types`; re-exported so daemon callers keep one import path.
export type {
  SnapshotComparison,
  SnapshotEntry,
  SnapshotEntryKind,
  SnapshotEntryLayer,
  SnapshotReference,
  SourceSnapshot,
}

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

/** The small immutable handoff a receipt or a verification request carries. */
export function snapshotReference(snapshot: SourceSnapshot): SnapshotReference {
  return { id: snapshot.id, complete: snapshot.complete, capturedAt: snapshot.capturedAt }
}

/**
 * Applicability of one snapshot against another.
 *
 * `unknown` is the honest answer whenever either side is incomplete — a snapshot that could not
 * fingerprint everything must never be reported as unchanged.
 */
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
  const exclusions: { path: string; reason: ReviewScopeReason }[] = []
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

  // No coherence re-check is possible here, and pretending otherwise would be worse than none: the
  // capture reads Git metadata from a *frozen copy* made in scratch, so a writer touching the live
  // repository mid-capture cannot move the refs or index this snapshot sees. It is by construction
  // stable, not by check. What can still change under us is worktree *content*, which is read live
  // through the fd-pinned directory; a file that changes while being read is reported as `unstable`
  // above. A change landing between the listing and the read is not detected, and the manifest simply
  // fingerprints the bytes it read — that limit is stated rather than papered over.

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
