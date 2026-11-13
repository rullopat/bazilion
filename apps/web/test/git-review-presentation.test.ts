import type { RepositoryChanges, ReviewChange } from '@bazilion/api-types'
import { expect, test } from 'vitest'
import {
  baseLabel,
  changeStatusLabel,
  changeSummary,
  unavailableMessage,
} from '../src/lib/git-review-presentation.ts'

function change(overrides: Partial<ReviewChange> = {}): ReviewChange {
  return {
    path: 'app.txt',
    previousPath: null,
    status: 'modified',
    binary: false,
    addedLines: 3,
    deletedLines: 1,
    patch: null,
    patchTruncated: false,
    contentOmitted: null,
    excludedReason: null,
    ...overrides,
  }
}

function changes(overrides: Partial<RepositoryChanges> = {}): RepositoryChanges {
  return {
    base: { requestedRef: 'HEAD', resolvedOid: 'a'.repeat(40) },
    identity: { branch: 'main', head: 'a'.repeat(40), headState: 'branch' },
    changes: [],
    truncated: false,
    withheld: { untracked: 0, excluded: 0 },
    issues: [],
    ...overrides,
  }
}

test('a change reads as its status plus counts, never a bare zero', () => {
  expect(changeSummary(change())).toBe('modified · +3 −1')
  expect(changeSummary(change({ status: 'added', addedLines: 12, deletedLines: 0 }))).toBe(
    'added · +12 −0',
  )
  expect(changeSummary(change({ binary: true }))).toBe('modified · binary')
})

test('a withheld file says so instead of looking like an empty diff', () => {
  expect(changeSummary(change({ excludedReason: 'credential_shaped' }))).toBe(
    'modified · content withheld (credential-shaped)',
  )
  expect(changeSummary(change({ excludedReason: 'bazilion_state' }))).toBe(
    'modified · content withheld (Bazilion state)',
  )
  expect(changeStatusLabel('type_changed')).toBe('type changed')
})

test('the label distinguishes a branch, a detached head and an unborn branch', () => {
  expect(baseLabel({ branch: 'main', head: 'a'.repeat(40), headState: 'branch' }, changes())).toBe(
    `main · base HEAD (${'a'.repeat(12)})`,
  )
  expect(
    baseLabel({ branch: null, head: 'b'.repeat(40), headState: 'detached' }, changes()),
  ).toContain('detached at')
  expect(baseLabel({ branch: 'main', head: null, headState: 'unborn' }, changes())).toContain(
    'unborn on main',
  )
})

test('an unavailable review reads as not reviewable, never as an empty change list', () => {
  expect(unavailableMessage('not_repository', 'fallback')).toContain('not a Git repository')
  expect(unavailableMessage('unsupported_layout', 'fallback')).toContain('does not widen mounts')
  expect(unavailableMessage('unknown_base', 'fallback')).toContain('does not name a commit')
  expect(unavailableMessage(undefined, 'fallback')).toBe('fallback')
})
