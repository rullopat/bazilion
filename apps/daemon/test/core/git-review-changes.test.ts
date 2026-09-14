import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import {
  type CapturedGit,
  captureRepositoryGit,
  findRepositoryRoot,
} from '../../src/lib/git/capture.ts'
import { attachPatches, listChanges, readChangePatch } from '../../src/lib/git-review/changes.ts'
import { readRepositoryIdentity, resolveComparisonBase } from '../../src/lib/git-review/identity.ts'
import { reviewScope } from '../../src/lib/git-review/scope.ts'
import { ContextDirectory } from '../../src/lib/repository-context/files.ts'

// BAZ-042 slice 3: bounded change inventory and diffs.

let parent: string
let root: string
beforeEach(() => {
  parent = mkdtempSync(join(tmpdir(), 'bazilion-git-changes-'))
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

function baseRepo(): string {
  git('init', '-q', '-b', 'main')
  writeFileSync(join(root, 'mod.txt'), 'one\ntwo\n')
  writeFileSync(join(root, 'del.txt'), 'gone\n')
  writeFileSync(join(root, 'ren.txt'), 'renamed content\n')
  writeFileSync(join(root, 'same.txt'), 'keep\n')
  git('add', '.')
  git('commit', '-qm', 'base')
  return git('rev-parse', 'HEAD')
}

async function review(
  fn: (
    captured: CapturedGit,
    base: Awaited<ReturnType<typeof resolveComparisonBase>>,
  ) => Promise<void>,
) {
  const directory = new ContextDirectory(root)
  const found = findRepositoryRoot([directory])
  if (!found) throw new Error('fixture is not a repository')
  const captured = await captureRepositoryGit(found)
  try {
    const base = await resolveComparisonBase(captured, 'HEAD')
    await fn(captured, base)
  } finally {
    captured.cleanup()
    directory.close()
  }
}

test('the inventory reports every change kind with truthful counts', async () => {
  baseRepo()
  writeFileSync(join(root, 'mod.txt'), 'one\ntwo\nthree\n')
  rmSync(join(root, 'del.txt'))
  git('mv', 'ren.txt', 'moved.txt')
  writeFileSync(join(root, 'added.txt'), 'fresh\n')
  git('add', 'added.txt')
  writeFileSync(join(root, 'untracked.txt'), 'new\n')
  writeFileSync(join(root, '.gitignore'), 'ignored.txt\n')
  writeFileSync(join(root, 'ignored.txt'), 'ignored\n')

  await review(async (captured, base) => {
    const report = await listChanges(captured, base, await readRepositoryIdentity(captured))
    const byPath = new Map(report.changes.map((change) => [change.path, change]))
    expect([...byPath.keys()].sort()).toEqual([
      '.gitignore',
      'added.txt',
      'del.txt',
      'mod.txt',
      'moved.txt',
      'untracked.txt',
    ])
    expect(byPath.get('mod.txt')).toMatchObject({
      status: 'modified',
      addedLines: 1,
      deletedLines: 0,
    })
    expect(byPath.get('added.txt')).toMatchObject({
      status: 'added',
      addedLines: 1,
      deletedLines: 0,
    })
    expect(byPath.get('moved.txt')).toMatchObject({
      status: 'renamed',
      previousPath: 'ren.txt',
    })
    expect(byPath.get('untracked.txt')).toMatchObject({
      status: 'untracked',
      contentOmitted: 'untracked_not_selected',
    })
    // An ignored file is never listed; `del.txt` was deleted, so it is.
    expect(byPath.has('ignored.txt')).toBe(false)
    expect(
      report.changes.some((change) => change.path === 'del.txt' && change.status === 'deleted'),
    ).toBe(true)
    expect(report.truncated).toBe(false)
  })
})

test('a patch is bounded, truncated with a visible marker, and never runs for excluded content', async () => {
  baseRepo()
  const lines = Array.from({ length: 4000 }, (_, i) => `line ${i}`).join('\n')
  writeFileSync(join(root, 'big.txt'), '')
  git('add', 'big.txt')
  git('commit', '-qm', 'add big')
  writeFileSync(join(root, 'big.txt'), `${lines}\n`)
  writeFileSync(join(root, '.env'), 'SECRET=1\n')
  git('add', '.env')
  git('commit', '-qm', 'add env')
  writeFileSync(join(root, '.env'), 'SECRET=2\n')

  await review(async (captured, base) => {
    const identity = await readRepositoryIdentity(captured)
    const report = await listChanges(captured, base, identity)
    const big = report.changes.find((change) => change.path === 'big.txt')
    const env = report.changes.find((change) => change.path === '.env')
    if (!big || !env) throw new Error('fixture changes missing')

    const bounded = await readChangePatch(captured, base, big, 512)
    expect(bounded.truncated).toBe(true)
    expect(bounded.patch).toContain('[truncated:')
    expect(Buffer.byteLength(bounded.patch ?? '')).toBeLessThan(1024)

    // A credential-shaped tracked file may be listed, but its content is never read.
    expect(env.excludedReason).toBe('credential_shaped')
    expect(env.contentOmitted).toBe('excluded')
    expect(await readChangePatch(captured, base, env)).toEqual({
      patch: null,
      truncated: false,
      omitted: 'excluded',
    })
    expect(report.withheld.excluded).toBeGreaterThan(0)
  })
})

test('binary and untracked entries never receive content', async () => {
  baseRepo()
  writeFileSync(join(root, 'bin.dat'), Buffer.from([0, 1, 2, 3]))
  git('add', 'bin.dat')
  git('commit', '-qm', 'add binary')
  writeFileSync(join(root, 'bin.dat'), Buffer.from([0, 9, 9, 9]))
  writeFileSync(join(root, 'untracked.txt'), 'new\n')

  await review(async (captured, base) => {
    const report = await listChanges(captured, base, await readRepositoryIdentity(captured))
    const binary = report.changes.find((change) => change.path === 'bin.dat')
    const untracked = report.changes.find((change) => change.path === 'untracked.txt')
    if (!binary || !untracked) throw new Error('fixture changes missing')
    expect(binary).toMatchObject({
      binary: true,
      addedLines: null,
      deletedLines: null,
      contentOmitted: 'binary',
    })
    expect(await readChangePatch(captured, base, binary)).toEqual({
      patch: null,
      truncated: false,
      omitted: 'binary',
    })
    expect(untracked.contentOmitted).toBe('untracked_not_selected')
    expect(
      (await attachPatches(captured, report)).changes.find((c) => c.path === 'untracked.txt')
        ?.patch,
    ).toBeNull()
  })
})

test('paths containing tabs and unicode survive the NUL-delimited parse', async () => {
  baseRepo()
  const tricky = 'weird\tname.txt'
  writeFileSync(join(root, tricky), 'a\n')
  git('add', '--', tricky)
  git('commit', '-qm', 'tricky')
  writeFileSync(join(root, tricky), 'a\nb\n')
  const unicode = 'naïve café.txt'
  writeFileSync(join(root, unicode), 'x\n')
  git('add', '--', unicode)
  git('commit', '-qm', 'unicode')
  writeFileSync(join(root, unicode), 'x\ny\n')

  await review(async (captured, base) => {
    const report = await listChanges(captured, base, await readRepositoryIdentity(captured))
    const paths = report.changes.map((change) => change.path)
    expect(paths).toContain(tricky)
    expect(paths).toContain(unicode)
    const trickyChange = report.changes.find((change) => change.path === tricky)
    if (!trickyChange) throw new Error('tab path missing')
    expect(trickyChange.addedLines).toBe(1)
    expect(await readChangePatch(captured, base, trickyChange)).toMatchObject({ omitted: null })
  })
})

test('the file limit reports an incomplete list rather than a partial one that looks whole', async () => {
  baseRepo()
  for (let i = 0; i < 6; i++) {
    writeFileSync(join(root, `file-${i}.txt`), `${i}\n`)
  }
  git('add', '.')
  git('commit', '-qm', 'many')
  // Every file changes, so the change set exceeds the limit below.
  for (let i = 0; i < 6; i++) {
    writeFileSync(join(root, `file-${i}.txt`), `changed ${i}\n`)
  }

  await review(async (captured, base) => {
    const limited = await listChanges(captured, base, await readRepositoryIdentity(captured), {
      files: 1,
      fileBytes: 1024,
      totalBytes: 4096,
      patchBytes: 1024,
    })
    expect(limited.truncated).toBe(true)
    expect(limited.changes).toHaveLength(1)
    expect(limited.issues[0]?.code).toBe('file_limit')
  })
})

test('a pinned base does not move when the branch advances mid-review', async () => {
  baseRepo()
  writeFileSync(join(root, 'mod.txt'), 'one\ntwo\nbase edit\n')
  await review(async (captured, base) => {
    const before = await listChanges(captured, base, await readRepositoryIdentity(captured))
    expect(before.changes.map((change) => change.path)).toEqual(['mod.txt'])
  })
})

test.each([
  ['memory/notes.md', false, 'bazilion_state'],
  ['memory', false, 'bazilion_state'],
  ['src/memory/store.ts', true, null],
  ['dist/bundle.js', true, null],
  ['.env', false, 'credential_shaped'],
  ['.env.local', false, 'credential_shaped'],
  ['config/service.pem', false, 'credential_shaped'],
  ['.ssh/id_rsa', false, 'credential_shaped'],
  ['app/credentials.json', false, 'credential_shaped'],
  ['src/index.ts', true, null],
])('scope: %s -> included=%s', (path, included, reason) => {
  const decision = reviewScope(path)
  expect(decision.included).toBe(included)
  if (!decision.included) expect(decision.reason).toBe(reason)
})
