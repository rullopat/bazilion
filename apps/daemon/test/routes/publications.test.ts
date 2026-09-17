import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  PublicationBlockedResponse,
  PublicationListResponse,
  PublicationResponse,
} from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { openConfig } from '../../src/core/repos/config.ts'
import {
  recordReviewConclusion,
  setReviewPacketState,
} from '../../src/core/repos/review-packets.ts'
import { openSecrets } from '../../src/core/repos/secrets.ts'
import { captureTeamSnapshot } from '../../src/lib/git-review/service.ts'
import { captureReviewPacket } from '../../src/lib/review/capture.ts'
import { teamsRouter } from '../../src/routes/teams.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

// BAZ-046 slice 3: the operator surfaces.
//
// The decision, its refusal and its outcome are all reached through the same route, and a refusal comes
// back as a result with a reason (409) rather than as an error: "nothing was sent, and here is why" is an
// answer, not a failure.

let env: TestEnv
let bare: string
vi.mock('../../src/lib/ctx.ts', () => ({
  getCtx: () => ({ db: env.db, paths: env.paths, authToken: 'test-only' }),
}))
vi.mock('../../src/lib/publication/execute.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/publication/execute.ts')>()),
  // The route's job is the decision, the record and the answer. The push itself is observed end to end in
  // publication-e2e.test.ts, against a real bare repository, where a stub would defeat the point.
  executePublication: async (db: BazilionDbLike, _paths: unknown, _token: string, id: string) => {
    db.raw.run(
      "UPDATE publications SET state = 'published', commit_oid = ?, finished_at = ? WHERE id = ?",
      ['a'.repeat(40), Date.now(), id],
    )
    return 'published' as const
  },
}))

type BazilionDbLike = TestEnv['db']

beforeEach(() => {
  env = makeTestEnv()
  bare = mkdtempSync(join(tmpdir(), 'bazilion-publication-route-bare-'))
  execFileSync('git', ['init', '--bare', '--quiet', bare], { encoding: 'utf8' })
  env.db.raw.run(
    "INSERT INTO profiles (id,name,dir,default_model,created_at,updated_at) VALUES ('profile','Profile','p','lmstudio:model',1,1)",
  )
  for (const id of ['coder', 'reviewer']) {
    env.db.raw.run(
      `INSERT INTO agents (id, profile_id, name, status, dir, team_id, created_at)
       VALUES (?, 'profile', ?, 'idle', ?, ?, 1)`,
      [id, id, `/tmp/${id}`, env.teamId],
    )
  }
  env.db.raw.run("INSERT INTO teams (id, name, created_at) VALUES ('other-team', 'Other', 1)")
})
afterEach(() => {
  env.cleanup()
  rmSync(bare, { recursive: true, force: true })
})

function git(...args: string[]): string {
  return execFileSync('git', ['-C', env.paths.teamDir(env.teamId), ...args], {
    encoding: 'utf8',
    env: {
      PATH: '/usr/bin:/bin',
      HOME: env.home,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  }).trim()
}

async function reviewedPacket(): Promise<string> {
  git('init', '-q', '-b', 'main')
  writeFileSync(join(env.paths.teamDir(env.teamId), 'app.js'), 'export const answer = 1\n')
  git('add', '.')
  git('commit', '-qm', 'base')
  writeFileSync(join(env.paths.teamDir(env.teamId), 'app.js'), 'export const answer = 42\n')
  const captured = await captureTeamSnapshot(env.db, env.paths, env.teamId, {
    capturedBy: 'agent',
    agentId: 'coder',
    turnId: 'turn-1',
    toolCallId: 'call-1',
    base: 'HEAD',
  })
  const packet = captureReviewPacket(env.db, env.paths, {
    teamId: env.teamId,
    snapshotId: captured.reference.id,
    reviewerAgentId: 'reviewer',
    summary: 'make the answer 42',
    requesterKind: 'agent',
    requesterAgentId: 'coder',
  })
  if (packet.kind !== 'captured') throw new Error('packet capture blocked')
  recordReviewConclusion(env.db, {
    packetId: packet.packet.id,
    reviewerKind: 'agent',
    reviewerAgentId: 'reviewer',
    conclusion: 'recommended',
    note: 'it is what it says',
    snapshotId: captured.reference.id,
  })
  setReviewPacketState(env.db, packet.packet.id, 'reviewed')
  return packet.packet.id
}

function configure(): void {
  const config = openConfig(env.db)
  config.set('PUBLICATION_HOST', 'local')
  config.set('PUBLICATION_REPOSITORY', bare)
  config.set('PUBLICATION_BASE_BRANCH', 'main')
  openSecrets(env.db, 'test-only').set('GITHUB_TOKEN', 'credential')
}

async function publish(packetId: string, overrides: Record<string, unknown> = {}) {
  return teamsRouter.request(`/${env.teamId}/publications`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ packetId, ...overrides }),
  })
}

test('an operator publishes a reviewed revision and reads the report back', async () => {
  const packetId = await reviewedPacket()
  configure()
  const created = await publish(packetId, { commitMessage: 'Answer 42' })
  expect(created.status).toBe(201)
  const body = (await created.json()) as PublicationResponse
  expect(body.report.publication).toMatchObject({
    packetId,
    state: 'published',
    signed: false,
    commitMessage: 'Answer 42',
    pullRequestUrl: null,
  })
  expect(body.report.facts).toEqual({
    contentFromReviewedRevision: true,
    nothingSent: false,
    pullRequestOpened: false,
    unsigned: true,
  })
  expect(body.report.guidance).toContain('branch is on the host')

  const listed = await teamsRouter.request(`/${env.teamId}/publications`)
  const list = (await listed.json()) as PublicationListResponse
  expect(list.publications).toHaveLength(1)
  // A wire publication carries no lease or notify fields: those are not a client's business.
  expect(Object.keys(list.publications[0] ?? {})).not.toContain('claimedBy')
  expect(Object.keys(list.publications[0] ?? {})).not.toContain('notifyAgentId')

  const shown = await teamsRouter.request(
    `/${env.teamId}/publications/${body.report.publication.id}`,
  )
  expect(((await shown.json()) as PublicationResponse).report.publication.id).toBe(
    body.report.publication.id,
  )
  // A Team-scoped read never leaks another Team's publication.
  const elsewhere = await teamsRouter.request(
    `/other-team/publications/${body.report.publication.id}`,
  )
  expect(elsewhere.status).toBe(404)
})

test('a refusal comes back as a reason, and nothing is published', async () => {
  const packetId = await reviewedPacket()
  // No host configured: the decision cannot be honoured, and nothing was sent.
  const refused = await publish(packetId)
  expect(refused.status).toBe(409)
  const body = (await refused.json()) as PublicationBlockedResponse
  expect(body.blocked.reason).toBe('host_not_configured')
  expect(body.blocked.detail).toContain('nothing was sent')

  configure()
  const protectedBranch = await publish(packetId, { headBranch: 'main' })
  expect(protectedBranch.status).toBe(409)
  expect(((await protectedBranch.json()) as PublicationBlockedResponse).blocked.reason).toBe(
    'branch_protected',
  )

  // A malformed body is refused before anything is read, and an unknown packet is a refusal too.
  const malformed = await teamsRouter.request(`/${env.teamId}/publications`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  expect(malformed.status).toBe(400)
  const unknown = await publish('no-such-packet')
  expect(unknown.status).toBe(409)
  expect(((await unknown.json()) as PublicationBlockedResponse).blocked.reason).toBe(
    'packet_unknown',
  )

  const listed = await teamsRouter.request(`/${env.teamId}/publications`)
  expect(((await listed.json()) as PublicationListResponse).publications).toEqual([])
  expect(git('for-each-ref', '--format=%(refname)')).toContain('refs/heads/main')
  expect(git('for-each-ref', '--format=%(refname)').includes('bazilion/')).toBe(false)
})
