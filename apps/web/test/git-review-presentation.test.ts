import { expect, test } from 'vitest'
import type { RepositoryChanges, ReviewChange } from '@bazilion/api-types'
import {
  baseLabel,
  changeStatusLabel,
  changeSummary,
  referenceLabel,
  snapshotLabel,
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
    oldMode: null,
    newMode: null,
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
    withheld: { untracked: 0, excluded: 0, binary: 0, tooLarge: 0 },
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

test('a withheld or unselected file says so instead of looking like an empty diff', () => {
  expect(changeSummary(change({ excludedReason: 'credential_shaped' }))).toBe(
    'modified · content withheld (credential-shaped)',
  )
  expect(changeSummary(change({ excludedReason: 'bazilion_state' }))).toBe(
    'modified · content withheld (Bazilion state)',
  )
  expect(changeSummary(change({ contentOmitted: 'untracked_not_selected' }))).toBe(
    'modified · content not selected',
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
  expect(
    baseLabel({ branch: 'main', head: null, headState: 'unborn' }, changes()),
  ).toContain('unborn on main')
})

test('an unavailable review reads as not reviewable, never as an empty change list', () => {
  expect(unavailableMessage('not_repository', 'fallback')).toContain('not a Git repository')
  expect(unavailableMessage('unsupported_layout', 'fallback')).toContain('does not widen mounts')
  expect(unavailableMessage('unknown_base', 'fallback')).toContain('does not name a commit')
  expect(unavailableMessage(undefined, 'fallback')).toBe('fallback')
})

test('an incomplete snapshot is never labelled as exact', () => {
  const summary = {
    snapshotId: 'c'.repeat(64),
    teamId: 'team',
    capturedBy: 'operator' as const,
    agentId: null,
    turnId: null,
    toolCallId: null,
    complete: false,
    head: 'a'.repeat(40),
    baseOid: 'a'.repeat(40),
    entryCount: 2,
    capturedContentBytes: 10,
    createdAt: 1_700_000_000_000,
    expiresAt: 1_700_000_000_000,
  }
  expect(snapshotLabel(summary)).toContain('incomplete')
  expect(snapshotLabel({ ...summary, complete: true })).toContain('complete')
  expect(referenceLabel({ id: 'd'.repeat(64), complete: false, capturedAt: 0 })).toBe(
    `${'d'.repeat(12)} · incomplete`,
  )
})
