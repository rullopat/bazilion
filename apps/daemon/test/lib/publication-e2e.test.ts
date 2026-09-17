import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { BazilionDb } from '../../src/core/db/client.ts'
import { openConfig } from '../../src/core/repos/config.ts'
import {
  getPublication,
  listPublications,
  recoverExpiredPublications,
} from '../../src/core/repos/publications.ts'
import {
  recordReviewConclusion,
  setReviewPacketState,
} from '../../src/core/repos/review-packets.ts'
import { openSecrets } from '../../src/core/repos/secrets.ts'
import { captureTeamSnapshot } from '../../src/lib/git-review/service.ts'
import { capturePublication } from '../../src/lib/publication/capture.ts'
import { executePublication } from '../../src/lib/publication/execute.ts'
import { buildPublicationReport } from '../../src/lib/publication/report.ts'
import { captureReviewPacket } from '../../src/lib/review/capture.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

// BAZ-046 observed end to end.
//
// The host here is a **real bare repository** on disk: the commit, the branch and the ref are genuine Git
// objects, read back with `git` itself. That is what makes "the reviewed revision was published" an
// observation rather than a claim about an HTTP call — and it needs no network and no credential, because
// the local adapter is a real adapter that simply has no pull requests to open.

let env: TestEnv
let bare: string
let scratchRoot: string
vi.mock('../../src/lib/ctx.ts', () => ({
  getCtx: () => ({ db: env.db, paths: env.paths, authToken: 'test-only' }),
}))

beforeEach(() => {
  env = makeTestEnv()
  bare = mkdtempSync(join(tmpdir(), 'bazilion-publication-bare-'))
  scratchRoot = mkdtempSync(join(tmpdir(), 'bazilion-publication-scratch-'))
})
afterEach(() => {
  env.cleanup()
  rmSync(bare, { recursive: true, force: true })
  rmSync(scratchRoot, { recursive: true, force: true })
})

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    env: {
      PATH: '/usr/bin:/bin',
      HOME: dir,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  }).trim()
}

function seed(db: BazilionDb, teamId: string): void {
  db.raw.run(
    "INSERT INTO profiles (id,name,dir,default_model,created_at,updated_at) VALUES ('profile','Profile','p','lmstudio:model',1,1)",
  )
  for (const id of ['coder', 'reviewer']) {
    db.raw.run(
      `INSERT INTO agents (id, profile_id, name, status, dir, team_id, created_at)
       VALUES (?, 'profile', ?, 'idle', ?, ?, 1)`,
      [id, id, `/tmp/${id}`, teamId],
    )
  }
}

/** A Team repository with a dirty change, plus a bare repository standing in for the host. */
function repositories(): void {
  const team = env.paths.teamDir(env.teamId)
  git(team, 'init', '-q', '-b', 'main')
  writeFileSync(join(team, 'app.js'), 'export const answer = 1\n')
  git(team, 'add', '.')
  git(team, 'commit', '-qm', 'base')
  writeFileSync(join(team, 'app.js'), 'export const answer = 42\n')
  execFileSync('git', ['init', '--bare', '--quiet', bare], { encoding: 'utf8' })
}

/** A reviewed packet: captured, then concluded and marked reviewed by the reviewer Agent. */
async function reviewedPacket(): Promise<string> {
  const captured = await captureTeamSnapshot(env.db, env.paths, env.teamId, {
    capturedBy: 'agent',
    agentId: 'coder',
    turnId: 'turn-1',
    toolCallId: 'call-1',
    base: 'HEAD',
  })
  const result = captureReviewPacket(env.db, env.paths, {
    teamId: env.teamId,
    snapshotId: captured.reference.id,
    reviewerAgentId: 'reviewer',
    summary: 'make the answer 42',
    requesterKind: 'agent',
    requesterAgentId: 'coder',
  })
  if (result.kind !== 'captured') throw new Error('packet capture blocked')
  recordReviewConclusion(env.db, {
    packetId: result.packet.id,
    reviewerKind: 'agent',
    reviewerAgentId: 'reviewer',
    conclusion: 'recommended',
    note: 'the change is what it says it is',
    snapshotId: captured.reference.id,
  })
  setReviewPacketState(env.db, result.packet.id, 'reviewed')
  return result.packet.id
}

/** Point the publication at the bare repository. */
function configure(input: { host?: string; repository?: string; credential?: string } = {}): void {
  const config = openConfig(env.db)
  config.set('PUBLICATION_HOST', input.host ?? 'local')
  config.set('PUBLICATION_REPOSITORY', input.repository ?? bare)
  config.set('PUBLICATION_BASE_BRANCH', 'main')
  const secrets = openSecrets(env.db, 'test-only')
  secrets.set('GITHUB_TOKEN', input.credential ?? 'local-test-credential')
}

async function publish(packetId: string, overrides: Record<string, unknown> = {}) {
  const captured = await capturePublication(env.db, env.paths, 'test-only', {
    teamId: env.teamId,
    packetId,
    ...overrides,
  })
  if (captured.kind !== 'captured') return { captured, outcome: null, publication: null } as const
  const outcome = await executePublication(
    env.db,
    env.paths,
    'test-only',
    captured.publication.id,
    {
      scratchParentDir: scratchRoot,
    },
  )
  return {
    captured,
    outcome,
    publication: getPublication(env.db, captured.publication.id),
  } as const
}

test('a reviewed revision is committed and pushed to a real branch, and the outcome is read back', async () => {
  seed(env.db, env.teamId)
  repositories()
  configure()
  const packetId = await reviewedPacket()

  const { captured, outcome, publication } = await publish(packetId)
  expect(captured.kind).toBe('captured')
  expect(outcome).toBe('published')
  expect(publication).toMatchObject({
    state: 'published',
    signed: false,
    pullRequestNumber: null,
    pullRequestUrl: null,
    error: null,
  })
  expect(publication?.headBranch).toMatch(/^bazilion\/review-[0-9a-f]{8}$/)

  // The branch exists on the host, and the commit is a real Git object whose tree holds the reviewed bytes.
  const ref = git(bare, 'rev-parse', `refs/heads/${publication?.headBranch}`)
  expect(ref).toBe(publication?.commitOid)
  const content = git(bare, 'show', `${ref}:app.js`)
  expect(content).toBe('export const answer = 42')
  // Based on the pinned base, so the branch shares the reviewed change's history rather than replacing it.
  const base = git(bare, 'rev-parse', `${ref}^`)
  expect(base).toBe(publication?.baseOid)
  // Unsigned, and no signature was attempted.
  expect(git(bare, 'log', '-1', '--format=%G?', ref)).toBe('N')

  // The requesting Agent is told the outcome through the canonical messenger — and nothing else.
  const inbox = env.db.raw
    .query<{ from_agent_id: string; to_agent_id: string; payload: string }, []>(
      'SELECT from_agent_id, to_agent_id, payload FROM messages',
    )
    .all()
  expect(inbox).toHaveLength(1)
  expect(inbox[0]).toMatchObject({ from_agent_id: 'reviewer', to_agent_id: 'coder' })
  expect(inbox[0]?.payload).toContain(publication?.headBranch)
  expect(inbox[0]?.payload).toContain(publication?.commitOid ?? '')
  expect(inbox[0]?.payload).toContain('unsigned')
  // The credential, the remote path and anything about the host's API stay out of it.
  expect(inbox[0]?.payload).not.toContain('local-test-credential')
  expect(inbox[0]?.payload).not.toContain(bare)

  // Running it twice publishes once: a second decision refuses rather than duplicating the branch.
  const again = await publish(packetId)
  expect(again.captured.kind).toBe('refused')
  if (again.captured.kind === 'refused') expect(again.captured.reason).toBe('already_published')

  const report = buildPublicationReport(publication!)
  expect(report.facts).toEqual({
    contentFromReviewedRevision: true,
    nothingSent: false,
    pullRequestOpened: false,
    unsigned: true,
  })
})

test('every refusal happens before anything is sent, and leaves no attempt behind', async () => {
  seed(env.db, env.teamId)
  repositories()
  const packetId = await reviewedPacket()

  // No host configured at all.
  const unconfigured = await publish(packetId)
  expect(unconfigured.captured.kind).toBe('refused')
  if (unconfigured.captured.kind === 'refused') {
    expect(unconfigured.captured.reason).toBe('host_not_configured')
  }

  // A host that is configured, with no credential: still nothing sent.
  configure({ credential: '' })
  const noCredential = await publish(packetId)
  expect(noCredential.captured.kind).toBe('refused')
  if (noCredential.captured.kind === 'refused') {
    expect(noCredential.captured.reason).toBe('credential_missing')
  }

  // The base branch and anything under it are never published to.
  configure()
  for (const branch of ['main', 'nested/main', 'master']) {
    const protectedName = await publish(packetId, { headBranch: branch })
    expect(protectedName.captured.kind, branch).toBe('refused')
    if (protectedName.captured.kind === 'refused') {
      expect(protectedName.captured.reason).toBe('branch_protected')
    }
  }
  // And a branch name that is not a ref this build will write.
  for (const branch of ['../evil', '-x', 'a//b', 'trailing/']) {
    const bad = await publish(packetId, { headBranch: branch })
    expect(bad.captured.kind, branch).toBe('refused')
  }

  // Every refusal above was decidable without asking the host, so none of them wrote a row at all —
  // and the host has no branches, because none of them sent anything.
  expect(listPublications(env.db, env.teamId)).toEqual([])
  expect(git(bare, 'for-each-ref', '--format=%(refname)')).toBe('')
})

test('a revision whose content moved is refused, never committed as reviewed', async () => {
  seed(env.db, env.teamId)
  repositories()
  configure()
  const packetId = await reviewedPacket()
  // The tree moves after the review: the same 42 becomes 43, so the reviewed bytes are gone.
  writeFileSync(join(env.paths.teamDir(env.teamId), 'app.js'), 'export const answer = 43\n')

  const { captured } = await publish(packetId)
  expect(captured.kind).toBe('refused')
  if (captured.kind === 'refused') {
    expect(captured.reason).toBe('revision_not_reproducible')
    expect(captured.detail).toContain('app.js')
  }
  expect(listPublications(env.db, env.teamId)).toEqual([])
  expect(git(bare, 'for-each-ref', '--format=%(refname)')).toBe('')
})

test('a packet that was never reviewed cannot be published', async () => {
  seed(env.db, env.teamId)
  repositories()
  configure()
  const captured = await captureTeamSnapshot(env.db, env.paths, env.teamId, {
    capturedBy: 'operator',
    base: 'HEAD',
  })
  const packet = captureReviewPacket(env.db, env.paths, {
    teamId: env.teamId,
    snapshotId: captured.reference.id,
    reviewerAgentId: null,
    requesterKind: 'operator',
  })
  if (packet.kind !== 'captured') throw new Error('packet capture blocked')

  const { captured: attempt } = await publish(packet.packet.id)
  expect(attempt.kind).toBe('refused')
  if (attempt.kind === 'refused') expect(attempt.reason).toBe('packet_not_reviewed')

  // A reviewed packet with no conclusion is refused too: "reviewed" without a verdict proves nothing.
  setReviewPacketState(env.db, packet.packet.id, 'reviewed')
  const noConclusion = await publish(packet.packet.id)
  expect(noConclusion.captured.kind).toBe('refused')
  if (noConclusion.captured.kind === 'refused') {
    expect(noConclusion.captured.reason).toBe('missing_reviewer_conclusion')
  }
})

// A refusal the daemon can decide alone leaves no row at all (observed above). A refusal that requires
// asking the host — this one — is recorded as a refused publication: the operator gets a reason instead of
// silence, and the row records that nothing was sent rather than an attempt that was made.
test('a branch that already exists on the host is refused, and nothing is overwritten', async () => {
  seed(env.db, env.teamId)
  repositories()
  configure()
  const packetId = await reviewedPacket()
  // Somebody already has work on the branch the default name would use.
  const existing = 'bazilion/review-conflict'
  const seedRepo = mkdtempSync(join(tmpdir(), 'bazilion-publication-seed-'))
  try {
    git(seedRepo, 'init', '-q', '-b', 'main')
    writeFileSync(join(seedRepo, 'other.txt'), 'somebody else\n')
    git(seedRepo, 'add', '.')
    git(seedRepo, 'commit', '-qm', 'theirs')
    git(seedRepo, 'push', '--quiet', bare, `HEAD:refs/heads/${existing}`)
  } finally {
    rmSync(seedRepo, { recursive: true, force: true })
  }
  const before = git(bare, 'rev-parse', `refs/heads/${existing}`)

  const { captured, outcome, publication } = await publish(packetId, { headBranch: existing })
  expect(captured.kind).toBe('captured')
  expect(outcome).toBe('refused')
  expect(publication).toMatchObject({
    state: 'refused',
    refusalReason: 'head_branch_exists',
    commitOid: null,
    pullRequestNumber: null,
  })
  expect(publication?.refusalDetail).toContain(existing)
  // A refusal means nothing was sent: the row says so, and the branch is untouched.
  expect(buildPublicationReport(publication!).facts.nothingSent).toBe(true)
  expect(git(bare, 'rev-parse', `refs/heads/${existing}`)).toBe(before)
})

test('an interrupted attempt becomes uncertain, never failed', async () => {
  seed(env.db, env.teamId)
  repositories()
  configure()
  const packetId = await reviewedPacket()
  // A decision that was claimed and left claimed: the process that held it is gone.
  const captured = await capturePublication(env.db, env.paths, 'test-only', {
    teamId: env.teamId,
    packetId,
  })
  if (captured.kind !== 'captured') throw new Error('capture blocked')
  env.db.raw.run(
    "UPDATE publications SET state = 'publishing', claimed_by = 'gone', lease_expires_at = ? WHERE id = ?",
    [Date.now() - 1_000, captured.publication.id],
  )

  expect(recoverExpiredPublications(env.db)).toEqual([captured.publication.id])
  const recovered = getPublication(env.db, captured.publication.id)
  expect(recovered?.state).toBe('uncertain')
  expect(recovered?.error).toContain('whether the branch reached the host is unknown')
  // A recovered attempt is not silently retried.
  const retry = await executePublication(env.db, env.paths, 'test-only', captured.publication.id, {
    scratchParentDir: scratchRoot,
  })
  expect(retry).toBe('not_claimed')
})
