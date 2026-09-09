/** Passive captured context; never a code-verification receipt or execution authorization. */
export interface RepositoryContextIssue {
  code: string
  path?: string
  message: string
}

export interface RepositoryInstruction {
  path: string
  scope: string
  precedence: number
  sha256: string
  content: string
}

export interface RepositoryCommandSource {
  path: string
  sha256: string
}

export interface RepositoryCommandCandidate {
  source: string
  sha256: string
  location: string
  cwd: string
  kind: 'script' | 'excerpt'
  command: string
  /** Null means sources do not establish an unambiguous package manager. */
  packageManager: 'npm' | 'pnpm' | 'yarn' | null
}

export interface RepositoryContextReport {
  version: 1
  teamId: string
  /** Opaque canonical filesystem identity, not a host path. */
  rootIdentity: string | null
  target: string
  capturedAt: number
  fingerprint: string
  instructions: {
    state: 'complete' | 'incomplete'
    files: RepositoryInstruction[]
    issues: RepositoryContextIssue[]
  }
  commands: {
    state: 'complete' | 'incomplete'
    sources: RepositoryCommandSource[]
    candidates: RepositoryCommandCandidate[]
    issues: RepositoryContextIssue[]
  }
  git: {
    state: 'available' | 'not_repository' | 'unavailable'
    root: string | null
    branch: string | null
    head: string | null
    headState: 'branch' | 'detached' | 'unborn' | null
    staged: number
    unstaged: number
    untracked: number
    conflicted: number
    issues: RepositoryContextIssue[]
  }
}

export interface RepositoryContextRequest {
  target?: string
}
