import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PinnedBase } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test } from 'vitest'
import {
  type CapturedGit,
  captureRepositoryGit,
  findRepositoryRoot,
} from '../../src/lib/git/capture.ts'
import { ContextDirectory } from '../../src/lib/git/context-directory.ts'
import {
  ReviewBaseError,
  readRepositoryIdentity,
  resolveComparisonBase,
} from '../../src/lib/git-review/identity.ts'
import { runGit } from '../fixtures/git.ts'

// BAZ-042 slice 2: repository identity and comparison-base resolution. A review must pin a concrete
// commit, so a branch tip moving later cannot silently rewrite what was reviewed.

let parent: string
let root: string
beforeEach(() => {
  parent = mkdtempSync(join(tmpdir(), 'bazilion-git-review-'))
  root = join(parent, 'repo')
  mkdirSync(root)
})
afterEach(() => rmSync(parent, { recursive: true, force: true }))

const git = (...args: string[]) => runGit(root, parent, ...args)

function commit(message: string, content = message): string {
  writeFileSync(join(root, 'code.txt'), `${content}\n`)
  git('add', '.')
  git('commit', '-qm', message)
  return git('rev-parse', 'HEAD')
}

/** Capture + a recording wrapper, so a test can prove Git was never invoked. */
async function withCapture(fn: (captured: CapturedGit, calls: string[][]) => Promise<void>) {
  const directory = new ContextDirectory(root)
  const found = findRepositoryRoot([directory])
  if (!found) throw new Error('fixture is not a repository')
  const real = await captureRepositoryGit(found)
  const calls: string[][] = []
  const recorded: CapturedGit = {
    ...real,
    runGit: (args) => {
      calls.push(args)
      return real.runGit(args)
    },
  }
  try {
    await fn(recorded, calls)
  } finally {
    real.cleanup()
    directory.close()
  }
}

test('identity reports branch, head and a base pinned to a concrete commit', async () => {
  git('init', '-q', '-b', 'main')
  const head = commit('initial')
  await withCapture(async (captured) => {
    expect(await readRepositoryIdentity(captured)).toEqual({
      branch: 'main',
      head,
      headState: 'branch',
    })
    expect(await resolveComparisonBase(captured)).toEqual({
      requestedRef: 'HEAD',
      resolvedOid: head,
    })
  })
})

test('a moved branch tip cannot rewrite an already pinned base', async () => {
  git('init', '-q', '-b', 'main')
  const first = commit('initial')
  let pinned: PinnedBase | undefined
  await withCapture(async (captured) => {
    pinned = await resolveComparisonBase(captured, 'main')
    expect(pinned.resolvedOid).toBe(first)
  })
  const second = commit('second')
  await withCapture(async (captured) => {
    // A later capture sees the moved tip...
    const fresh = await resolveComparisonBase(captured, 'main')
    expect(fresh.resolvedOid).toBe(second)
    // ...while the pinned base still names the commit that was actually reviewed.
    if (!pinned) throw new Error('fixture did not pin a base')
    expect(pinned.resolvedOid).not.toBe(fresh.resolvedOid)
    expect(
      (await captured.runGit(['rev-parse', '--verify', `${pinned.resolvedOid}^{commit}`])).trim(),
    ).toBe(pinned.resolvedOid)
  })
})

test('one capture freezes the refs it reads, so a base cannot shift mid-review', async () => {
  git('init', '-q', '-b', 'main')
  const first = commit('initial')
  await withCapture(async (captured) => {
    const pinned = await resolveComparisonBase(captured, 'main')
    // Committing while the capture is open does not move what this review sees: the refs, index and
    // objects were copied into private scratch, so the frozen metadata supplies the same answer.
    const second = commit('second')
    expect(second).not.toBe(first)
    expect((await resolveComparisonBase(captured, 'main')).resolvedOid).toBe(pinned.resolvedOid)
    expect((await readRepositoryIdentity(captured)).head).toBe(first)
  })
})

test('tags and raw commit ids resolve, and non-commit objects are refused', async () => {
  git('init', '-q', '-b', 'main')
  const head = commit('initial')
  git('tag', '-a', 'v1', '-m', 'release')
  const blob = git('hash-object', '-w', '--stdin')
  await withCapture(async (captured) => {
    expect((await resolveComparisonBase(captured, 'v1')).resolvedOid).toBe(head)
    expect((await resolveComparisonBase(captured, head)).resolvedOid).toBe(head)
    // A blob id is a valid ref shape but not a commit.
    await expect(resolveComparisonBase(captured, blob)).rejects.toMatchObject({
      code: 'unknown_base',
    })
  })
})

test('detached and unborn heads are distinguished', async () => {
  git('init', '-q', '-b', 'main')
  await withCapture(async (captured) => {
    expect(await readRepositoryIdentity(captured)).toEqual({
      branch: 'main',
      head: null,
      headState: 'unborn',
    })
    await expect(resolveComparisonBase(captured)).rejects.toMatchObject({ code: 'unknown_base' })
  })
  const head = commit('initial')
  git('checkout', '-q', '--detach')
  await withCapture(async (captured) => {
    expect(await readRepositoryIdentity(captured)).toEqual({
      branch: null,
      head,
      headState: 'detached',
    })
  })
})

test('revision syntax such as HEAD~1 and HEAD^ resolves to a pinned commit', async () => {
  git('init', '-q', '-b', 'main')
  const parent = commit('initial')
  commit('second')
  await withCapture(async (captured) => {
    for (const ref of ['HEAD~1', 'HEAD^', 'main~1']) {
      expect(await resolveComparisonBase(captured, ref)).toEqual({
        requestedRef: ref,
        resolvedOid: parent,
      })
    }
  })
})

test.each([
  ['--upload-pack=/tmp/evil', 'option injection'],
  ['-n', 'bare option'],
  ['a b', 'whitespace'],
  ['main\n', 'control byte'],
  ['', 'empty'],
  ['a'.repeat(256), 'over-long'],
])('an unsafe base %s is refused before Git runs (%s)', async (ref) => {
  git('init', '-q', '-b', 'main')
  commit('initial')
  await withCapture(async (captured, calls) => {
    await expect(resolveComparisonBase(captured, ref)).rejects.toBeInstanceOf(ReviewBaseError)
    // Validation happens before any process starts: nothing was invoked.
    expect(calls).toEqual([])
  })
})

test('a well-formed but unknown ref fails explicitly instead of falling back', async () => {
  git('init', '-q', '-b', 'main')
  commit('initial')
  await withCapture(async (captured) => {
    await expect(resolveComparisonBase(captured, 'no-such-branch')).rejects.toMatchObject({
      code: 'unknown_base',
    })
    // Nothing was pinned, so a caller cannot accidentally compare against HEAD.
    await expect(resolveComparisonBase(captured, 'no-such-branch')).rejects.toBeInstanceOf(
      ReviewBaseError,
    )
  })
})
