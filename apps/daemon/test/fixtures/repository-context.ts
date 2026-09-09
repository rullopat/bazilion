import type { RepositoryContextReport } from '@bazilion/api-types'

/** Empty admitted snapshot for worker protocol fixtures that do not read repository files. */
export function emptyRepositoryContext(teamId: string): RepositoryContextReport {
  return {
    version: 1,
    teamId,
    rootIdentity: '0'.repeat(64),
    target: '.',
    capturedAt: 1,
    fingerprint: '1'.repeat(64),
    instructions: { state: 'complete', files: [], issues: [] },
    commands: { state: 'complete', sources: [], candidates: [], issues: [] },
    git: {
      state: 'not_repository',
      root: null,
      head: null,
      branch: null,
      headState: null,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      conflicted: 0,
      issues: [],
    },
  }
}
