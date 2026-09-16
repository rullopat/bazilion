import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import type { VerificationRequestRecord } from '../../src/core/repos/verification-requests.ts'
import {
  compareWorkspaceFingerprints,
  fingerprintWorkspace,
  isDeclaredOutputPath,
  type WorkspaceFingerprint,
} from '../../src/lib/verification/writes.ts'

// BAZ-044 gap: declared output paths are advisory, so the honest closure is to make the declaration
// *checkable* — compare the tree before and after the checks and report writes the declaration did not
// cover. These tests cover the comparison itself; the end-to-end case covers it through a real dispatch.

function requestWith(declared: string[] | undefined): VerificationRequestRecord {
  return {
    id: 'request',
    environment: { writablePaths: declared },
  } as unknown as VerificationRequestRecord
}

function fingerprint(entries: Record<string, string>, truncated = false): WorkspaceFingerprint {
  return { entries: new Map(Object.entries(entries)), truncated }
}

test('a declaration covers its subtree by path segment, never by string prefix', () => {
  expect(isDeclaredOutputPath('build/out.txt', 'build')).toBe(true)
  expect(isDeclaredOutputPath('build', 'build')).toBe(true)
  expect(isDeclaredOutputPath('./build/nested/out.txt', 'build')).toBe(true)
  expect(isDeclaredOutputPath('build', 'build/')).toBe(true)
  // The case a string prefix gets wrong: a sibling directory whose name starts the same way.
  expect(isDeclaredOutputPath('build-output/out.txt', 'build')).toBe(false)
  expect(isDeclaredOutputPath('src/app.ts', 'build')).toBe(false)
})

test('observed writes are split by whether the declaration covered them', () => {
  const baseline = fingerprint({ 'app.txt': 'sha256:a', 'build/out.txt': 'sha256:b' })
  const after = fingerprint({
    'app.txt': 'sha256:a',
    'build/out.txt': 'sha256:c',
    'stray.txt': 'sha256:d',
  })
  const observed = compareWorkspaceFingerprints(requestWith(['build']), baseline, after)
  expect(observed).toMatchObject({
    comparison: 'changed',
    declaredPaths: ['build'],
    undeclaredPaths: ['stray.txt'],
    truncated: false,
  })
  expect(observed.observedPaths).toEqual(['build/out.txt', 'stray.txt'])
})

test('nothing moved, and a declaration that covers everything, are both reported plainly', () => {
  const same = fingerprint({ 'app.txt': 'sha256:a' })
  expect(compareWorkspaceFingerprints(requestWith(['build']), same, same)).toMatchObject({
    comparison: 'identical',
    observedPaths: [],
    undeclaredPaths: [],
  })
  const before = fingerprint({})
  const after = fingerprint({ 'build/out.txt': 'sha256:b' })
  expect(compareWorkspaceFingerprints(requestWith(['build']), before, after)).toMatchObject({
    undeclaredPaths: [],
    observedPaths: ['build/out.txt'],
  })
  // With no declaration at all, every observed path is undeclared — the field still says where.
  expect(compareWorkspaceFingerprints(requestWith(undefined), before, after)).toMatchObject({
    declaredPaths: [],
    undeclaredPaths: ['build/out.txt'],
  })
})

test('a missing baseline is unknown, never "nothing was written"', () => {
  const seen = fingerprint({ 'app.txt': 'sha256:a' })
  for (const observed of [
    compareWorkspaceFingerprints(requestWith(['build']), null, seen),
    compareWorkspaceFingerprints(requestWith(['build']), seen, null),
  ]) {
    expect(observed).toMatchObject({
      comparison: 'unknown',
      observedPaths: [],
      undeclaredPaths: [],
    })
  }
})

test('a removed path is an observed write too', () => {
  const before = fingerprint({ 'kept.txt': 'sha256:a', 'gone.txt': 'sha256:b' })
  const after = fingerprint({ 'kept.txt': 'sha256:a' })
  expect(compareWorkspaceFingerprints(requestWith([]), before, after)).toMatchObject({
    comparison: 'changed',
    undeclaredPaths: ['gone.txt'],
  })
})

test('the fingerprint sees a same-size rewrite of an already-dirty file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'baz044-writes-'))
  try {
    // The failure mode a size+mtime fingerprint misses — and the one this machine's filesystem clock
    // made real during BAZ-042's fixture flake. Content, not size, decides.
    writeFileSync(join(root, 'app.txt'), 'ab')
    const before = await fingerprintWorkspace(root)
    writeFileSync(join(root, 'app.txt'), 'cd')
    const after = await fingerprintWorkspace(root)
    expect(compareWorkspaceFingerprints(requestWith([]), before, after).undeclaredPaths).toEqual([
      'app.txt',
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the fingerprint walks build output, skips repository internals, and records non-files safely', async () => {
  const root = mkdtempSync(join(tmpdir(), 'baz044-writes-'))
  try {
    mkdirSync(join(root, 'dist'), { recursive: true })
    mkdirSync(join(root, '.git', 'objects', 'aa'), { recursive: true })
    writeFileSync(join(root, '.git', 'objects', 'aa', 'blob'), 'internal')
    writeFileSync(join(root, 'dist', 'bundle.js'), 'built')
    symlinkSync('dist/bundle.js', join(root, 'link.js'))
    const print = await fingerprintWorkspace(root)
    // `dist` is exactly what the review scope excludes, so the observation cannot go through it.
    expect(print.entries.has('dist/bundle.js')).toBe(true)
    expect(print.entries.has('.git/objects/aa/blob')).toBe(false)
    expect(print.entries.get('link.js')).toBe('link:dist/bundle.js')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a check that writes a whole tree reports truncation instead of an unbounded list', async () => {
  const root = mkdtempSync(join(tmpdir(), 'baz044-writes-'))
  try {
    const before = await fingerprintWorkspace(root)
    for (let index = 0; index < 60; index++) {
      writeFileSync(join(root, `out-${index}.txt`), String(index))
    }
    const after = await fingerprintWorkspace(root)
    const observed = compareWorkspaceFingerprints(requestWith([]), before, after)
    expect(observed.observedPaths).toHaveLength(50)
    expect(observed.truncated).toBe(true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
