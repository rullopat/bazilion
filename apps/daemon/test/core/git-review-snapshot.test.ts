import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import {
  type CapturedGit,
  captureRepositoryGit,
  findRepositoryRoot,
} from '../../src/lib/git/capture.ts'
import { REVIEW_LIMITS, type ReviewLimits } from '../../src/lib/git-review/changes.ts'
import { readRepositoryIdentity, resolveComparisonBase } from '../../src/lib/git-review/identity.ts'
import {
  captureSourceSnapshot,
  compareSnapshots,
  type SourceSnapshot,
  snapshotReference,
} from '../../src/lib/git-review/snapshot.ts'
import { ContextDirectory } from '../../src/lib/repository-context/files.ts'

// BAZ-042 slice 4: bounded source snapshots and their immutable reference.

let parent: string
let root: string
beforeEach(() => {
  parent = mkdtempSync(join(tmpdir(), 'bazilion-git-snapshot-'))
  root = join(parent, 'repo')
  mkdirSync(root)
})
afterEach(() => rmSync(parent, { recursive: true, force: true }))

function git(...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: {
      PATH: '/usr/bin:/bin',
      HOME: parent,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  }).trim()
}

function repo(): void {
  git('init', '-q', '-b', 'main')
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src/app.txt'), 'one\ntwo\n')
  writeFileSync(join(root, 'readme.md'), 'hello\n')
  git('add', '.')
  git('commit', '-qm', 'base')
}

/** Capture a snapshot inside one capture, closing everything afterwards. */
async function capture(
  fn: (
    captured: CapturedGit,
    snapshot: (input?: Parameters<typeof captureSourceSnapshot>[3]) => Promise<SourceSnapshot>,
  ) => Promise<void>,
) {
  const directory = new ContextDirectory(root)
  const found = findRepositoryRoot([directory])
  if (!found) throw new Error('fixture is not a repository')
  const captured = await captureRepositoryGit(found)
  try {
    const base = await resolveComparisonBase(captured, 'HEAD')
    const identity = await readRepositoryIdentity(captured)
    await fn(captured, (input) => captureSourceSnapshot(captured, base, identity, input))
  } finally {
    captured.cleanup()
    directory.close()
  }
}

test('a clean tree produces a complete snapshot identified by HEAD and the index', async () => {
  repo()
  await capture(async (_captured, snapshot) => {
    const first = await snapshot()
    expect(first.complete).toBe(true)
    expect(first.head).toBe(git('rev-parse', 'HEAD'))
    expect(first.indexDigest).not.toBeNull()
    expect(first.indexEntries).toBe(2)
    expect(first.entries).toEqual([])
    expect(first.issues).toEqual([])
  })
})

test('dirty content is fingerprinted by bytes, and the id depends only on the state', async () => {
  repo()
  writeFileSync(join(root, 'src/app.txt'), 'one\ntwo\nthree\n')
  await capture(async (_captured, snapshot) => {
    const first = await snapshot()
    expect(first.complete).toBe(true)
    expect(first.entries).toEqual([
      {
        path: 'src/app.txt',
        layer: 'worktree',
        kind: 'file',
        digest: expect.any(String),
        bytes: 14,
      },
    ])
    // Same state, later capture: identical id because `capturedAt` is not part of it.
    const again = await snapshot()
    expect(again.id).toBe(first.id)
    expect(again.capturedAt).toBeGreaterThanOrEqual(first.capturedAt)

    writeFileSync(join(root, 'src/app.txt'), 'one\ntwo\nFOUR\n')
    const edited = await snapshot()
    expect(edited.id).not.toBe(first.id)
    expect(compareSnapshots(first, edited)).toBe('changed')
    expect(compareSnapshots(first, again)).toBe('identical')
    // Modification times cannot distinguish a real edit from a touch, so they are never consulted:
    // reverting the bytes must restore the identity, even though mtime moved on.
    writeFileSync(join(root, 'src/app.txt'), 'one\ntwo\nthree\n')
    expect((await snapshot()).id).toBe(first.id)
  })
})

test('staging is captured in the index digest without reading file content', async () => {
  repo()
  let clean: string | null = null
  await capture(async (_captured, snapshot) => {
    clean = (await snapshot()).indexDigest
  })
  writeFileSync(join(root, 'src/app.txt'), 'staged content\n')
  git('add', 'src/app.txt')
  await capture(async (_captured, snapshot) => {
    const staged = await snapshot()
    expect(staged.indexDigest).not.toBe(clean)
    expect(staged.complete).toBe(true)
  })
})

test('untracked content is included only when explicitly selected', async () => {
  repo()
  writeFileSync(join(root, 'notes.txt'), 'scratch\n')
  writeFileSync(join(root, '.env'), 'SECRET=1\n')
  await capture(async (_captured, snapshot) => {
    // Nothing is included implicitly, even though the file exists.
    const implicit = await snapshot()
    expect(implicit.untrackedIncluded).toEqual([])
    expect(implicit.entries).toEqual([])

    const explicit = await snapshot({ includeUntracked: ['notes.txt', '.env'] })
    expect(explicit.untrackedIncluded).toEqual(['notes.txt'])
    expect(explicit.entries).toEqual([
      { path: 'notes.txt', layer: 'untracked', kind: 'file', digest: expect.any(String), bytes: 8 },
    ])
    // A credential-shaped path is refused and recorded, never read.
    expect(explicit.exclusions).toEqual([{ path: '.env', reason: 'credential_shaped' }])
    expect(explicit.withheld.excluded).toBe(1)
    expect(explicit.complete).toBe(true)
  })
})

test('an included path that no longer exists makes the snapshot incomplete, not silently absent', async () => {
  repo()
  await capture(async (_captured, snapshot) => {
    const missing = await snapshot({ includeUntracked: ['ghost.txt'] })
    expect(missing.complete).toBe(false)
    expect(missing.issues.map((issue) => issue.code)).toContain('unstable')
    expect(missing.entries).toEqual([
      { path: 'ghost.txt', layer: 'untracked', kind: 'unstable', digest: null, bytes: null },
    ])
    expect(compareSnapshots(missing, missing)).toBe('unknown')
  })
})

test('an oversized changed file is reported, not truncated into a misleading digest', async () => {
  repo()
  writeFileSync(join(root, 'src/app.txt'), 'x'.repeat(64))
  const limits: ReviewLimits = { ...REVIEW_LIMITS, fileBytes: 8 }
  await capture(async (_captured, snapshot) => {
    const bounded = await snapshot({ limits })
    expect(bounded.complete).toBe(false)
    expect(bounded.entries[0]).toMatchObject({ kind: 'too_large', digest: null })
    expect(bounded.withheld.tooLarge).toBe(1)
    expect(bounded.issues.map((issue) => issue.code)).toContain('file_limit')
  })
})

test('a changed path that is not a regular file cannot be fingerprinted', async () => {
  repo()
  rmSync(join(root, 'src/app.txt'))
  symlinkSync('/etc/hostname', join(root, 'src/app.txt'))
  await capture(async (_captured, snapshot) => {
    const linked = await snapshot()
    expect(linked.complete).toBe(false)
    expect(linked.entries[0]).toMatchObject({ kind: 'not_regular', digest: null })
    expect(linked.withheld.notRegular).toBe(1)
  })
})

test('a deleted tracked file is recorded as deleted rather than missing', async () => {
  repo()
  rmSync(join(root, 'readme.md'))
  await capture(async (_captured, snapshot) => {
    const deleted = await snapshot()
    expect(deleted.complete).toBe(true)
    expect(deleted.entries).toEqual([
      { path: 'readme.md', layer: 'worktree', kind: 'deleted', digest: null, bytes: null },
    ])
  })
})

test('an index larger than the file bound is incomplete', async () => {
  repo()
  const limits: ReviewLimits = { ...REVIEW_LIMITS, files: 1 }
  await capture(async (_captured, snapshot) => {
    const bounded = await snapshot({ limits })
    expect(bounded.complete).toBe(false)
    expect(bounded.issues.map((issue) => issue.code)).toContain('file_limit')
  })
})

test('the reference exposes identity, completeness and when it was taken', async () => {
  repo()
  await capture(async (_captured, snapshot) => {
    const captured = await snapshot()
    expect(snapshotReference(captured)).toEqual({
      id: captured.id,
      complete: true,
      capturedAt: captured.capturedAt,
    })
  })
})

test('a capture is a frozen view: a writer mid-capture cannot move what it sees', async () => {
  repo()
  writeFileSync(join(root, 'src/app.txt'), 'changed before capture\n')
  const directory = new ContextDirectory(root)
  const found = findRepositoryRoot([directory])
  if (!found) throw new Error('fixture is not a repository')
  const captured = await captureRepositoryGit(found)
  try {
    const before = await resolveComparisonBase(captured, 'HEAD')
    const identity = await readRepositoryIdentity(captured)
    const baseline = await captureSourceSnapshot(captured, before, identity)
    expect(baseline.complete).toBe(true)

    // Stage a new file and edit another one *after* the capture was taken. Git metadata was copied
    // into scratch, so the capture's view cannot move: this is a guarantee by construction, not one
    // a check provides. (The previous version of this test asserted a "coherence re-check" caught
    // this; it could not, because both index reads came from the same frozen copy.)
    writeFileSync(join(root, 'staged-later.txt'), 'racy\n')
    execFileSync('git', ['-C', root, 'add', 'staged-later.txt'], {
      encoding: 'utf8',
      env: {
        PATH: '/usr/bin:/bin',
        HOME: parent,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
      },
    })
    const again = await captureSourceSnapshot(captured, before, identity)
    expect(again.id).toBe(baseline.id)
    expect(again.indexDigest).toBe(baseline.indexDigest)
    expect(again.entries.map((entry) => entry.path)).not.toContain('staged-later.txt')
  } finally {
    captured.cleanup()
    directory.close()
  }
})

test('a fresh capture does see the writer, so the freeze is per-capture not permanent', async () => {
  repo()
  writeFileSync(join(root, 'src/app.txt'), 'first\n')
  const directory = new ContextDirectory(root)
  const found = findRepositoryRoot([directory])
  if (!found) throw new Error('fixture is not a repository')
  const captured = await captureRepositoryGit(found)
  try {
    const base = await resolveComparisonBase(captured, 'HEAD')
    const identity = await readRepositoryIdentity(captured)
    const first = await captureSourceSnapshot(captured, base, identity)
    writeFileSync(join(root, 'src/app.txt'), 'second\n')
    const second = await captureSourceSnapshot(captured, base, identity)
    // The frozen metadata is shared, but the worktree is read live, so content changes are seen.
    expect(second.id).not.toBe(first.id)
    expect(second.entries[0]?.digest).not.toBe(first.entries[0]?.digest)
  } finally {
    captured.cleanup()
    directory.close()
  }
})
