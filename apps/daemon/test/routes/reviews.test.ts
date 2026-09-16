import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReviewPacketReport, ReviewPacketResponse } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { teamsRouter } from '../../src/routes/teams.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

// BAZ-043 slice 4: the operator surface for review packets.
//
// The surfaces must agree with the model rules instead of re-deciding them: an invalid severity, a path
// outside the reviewed scope, a resolution without proof and an unverified finding all come back as
// refusals rather than as stored rows.

let env: TestEnv
vi.mock('../../src/lib/ctx.ts', () => ({
  getCtx: () => ({ db: env.db, paths: env.paths, authToken: 'test-only' }),
}))

beforeEach(() => {
  env = makeTestEnv()
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
})
afterEach(() => {
  env.cleanup()
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

async function snapshotId(): Promise<string> {
  git('init', '-q', '-b', 'main')
  writeFileSync(join(env.paths.teamDir(env.teamId), 'app.txt'), 'one\ntwo\n')
  git('add', '.')
  git('commit', '-qm', 'base')
  writeFileSync(join(env.paths.teamDir(env.teamId), 'app.txt'), 'one\ntwo\nthree\n')
  const response = await teamsRouter.request(`/${env.teamId}/review/snapshots`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  return ((await response.json()) as { reference: { id: string } }).reference.id
}

async function create(snapshot: string, overrides: Record<string, unknown> = {}) {
  return teamsRouter.request(`/${env.teamId}/reviews`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ snapshotId: snapshot, reviewerAgentId: 'reviewer', ...overrides }),
  })
}

async function packetWithFinding() {
  const packet = (await (await create(await snapshotId())).json()) as ReviewPacketResponse
  const packetId = packet.report.packet.id
  const created = await teamsRouter.request(`/${env.teamId}/reviews/${packetId}/findings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      path: 'app.txt',
      severity: 'major',
      note: 'the new branch is untested',
      lineStart: 3,
      lineEnd: 3,
    }),
  })
  const body = (await created.json()) as {
    finding: { id: string }
    report: ReviewPacketReport
  }
  return { packetId, findingId: body.finding.id, report: body.report }
}

test('an operator opens a packet, and the report names the revision and honest facts', async () => {
  const response = await create(await snapshotId(), { summary: 'review the fix' })
  expect(response.status).toBe(201)
  const body = (await response.json()) as ReviewPacketResponse
  expect(body.report.packet).toMatchObject({
    state: 'open',
    summary: 'review the fix',
    reviewerAgentId: 'reviewer',
  })
  expect(body.report.packet.requester).toEqual({ kind: 'operator', agentId: null })
  expect(body.report.applicability).toEqual({ comparison: 'identical', stale: false })
  // Nothing is claimed that has no evidence: no export, no review, no reported external state.
  expect(body.report.packet.exportedAt).toBeNull()
  expect(body.report.facts).toMatchObject({
    reviewed: false,
    reported: { committed: null, productionAccepted: null },
  })
})

test('a packet with no reviewer delegates nothing', async () => {
  const body = (await (
    await create(await snapshotId(), { reviewerAgentId: null })
  ).json()) as ReviewPacketResponse
  expect(body.report.packet.reviewerAgentId).toBeNull()
  const listed = (await (await teamsRouter.request(`/${env.teamId}/reviews`)).json()) as {
    packets: unknown[]
  }
  expect(listed.packets).toHaveLength(1)
})

test('findings are recorded against the reviewed revision, and hostile paths are refused', async () => {
  const { report } = await packetWithFinding()
  expect(report.findings[0]).toMatchObject({
    path: 'app.txt',
    severity: 'major',
    state: 'open',
    applicability: 'identical',
    resolution: null,
  })
  const packetId = report.packet.id

  const cases: Array<[Record<string, unknown>, string]> = [
    [{ path: 'app.txt', severity: 'catastrophic', note: 'x' }, 'invalid_severity'],
    [{ path: '../outside.txt', severity: 'major', note: 'x' }, 'invalid_path'],
    [{ path: '/etc/passwd', severity: 'major', note: 'x' }, 'invalid_path'],
    [{ path: 'app.txt', severity: 'major' }, 'invalid_finding'],
  ]
  for (const [body, code] of cases) {
    const response = await teamsRouter.request(`/${env.teamId}/reviews/${packetId}/findings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(response.status).toBe(400)
    expect(((await response.json()) as { code: string }).code).toBe(code)
  }
  const listed = (await (
    await teamsRouter.request(`/${env.teamId}/reviews/${packetId}`)
  ).json()) as ReviewPacketResponse
  expect(listed.report.findings).toHaveLength(1)
})

test('resolution requires proof, and an unverified finding cannot be resolved', async () => {
  const { packetId, findingId } = await packetWithFinding()
  const resolve = (body: Record<string, unknown>) =>
    teamsRouter.request(`/${env.teamId}/reviews/${packetId}/findings/${findingId}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  expect((await resolve({ resolutionKind: 'assumed', resolutionNote: 'x' })).status).toBe(400)
  expect((await resolve({ resolutionKind: 'explicit', resolutionNote: '   ' })).status).toBe(400)
  const resolved = await resolve({
    resolutionKind: 'linked_revision',
    resolutionNote: 'fixed in the follow-up capture',
  })
  expect(resolved.status).toBe(200)
  const body = (await resolved.json()) as ReviewPacketResponse
  expect(body.report.findings[0]).toMatchObject({
    state: 'resolved',
    resolution: { kind: 'linked_revision', by: { kind: 'operator', agentId: null } },
  })
  // Resolving again is refused instead of rewriting the decision.
  expect((await resolve({ resolutionKind: 'explicit', resolutionNote: 'again' })).status).toBe(400)
})

test('a conclusion is recorded per reviewer and never implies acceptance', async () => {
  const { packetId } = await packetWithFinding()
  const response = await teamsRouter.request(`/${env.teamId}/reviews/${packetId}/conclusion`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conclusion: 'changes_requested', note: 'one unresolved finding' }),
  })
  expect(response.status).toBe(200)
  const body = (await response.json()) as ReviewPacketResponse
  expect(body.report.conclusions).toEqual([
    expect.objectContaining({
      conclusion: 'changes_requested',
      reviewer: { kind: 'operator', agentId: null },
      snapshotId: body.report.packet.snapshot.id,
    }),
  ])
  // A review conclusion is a statement about a revision, not production acceptance.
  expect(body.report.facts.reported.productionAccepted).toBeNull()
  const invalid = await teamsRouter.request(`/${env.teamId}/reviews/${packetId}/conclusion`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conclusion: 'approved' }),
  })
  expect(invalid.status).toBe(400)
})

test('a packet of another Team is not reachable, and an unknown packet is a 404', async () => {
  const packet = (await (await create(await snapshotId())).json()) as ReviewPacketResponse
  env.db.raw.run("INSERT INTO teams (id, name, created_at) VALUES ('other-team', 'Other', 1)")
  const elsewhere = await teamsRouter.request(`/other-team/reviews/${packet.report.packet.id}`)
  expect(elsewhere.status).toBe(404)
  const unknown = await teamsRouter.request(`/${env.teamId}/reviews/does-not-exist`)
  expect(unknown.status).toBe(404)
})
