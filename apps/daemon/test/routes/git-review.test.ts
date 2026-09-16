import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  RepositoryReviewResponse,
  SourceSnapshot,
  SourceSnapshotListResponse,
  SourceSnapshotResponse,
} from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { registerTeam } from '../../src/core/index.ts'
import { teamsRouter } from '../../src/routes/teams.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

// BAZ-042 slice 5: Team-scoped review and snapshot routes.

let env: TestEnv
vi.mock('../../src/lib/ctx.ts', () => ({
  getCtx: () => ({ db: env.db, paths: env.paths, authToken: 'test-only' }),
}))

beforeEach(() => {
  env = makeTestEnv()
})
afterEach(() => {
  env.cleanup()
})

function teamDir(id = env.teamId): string {
  return env.paths.teamDir(id)
}

function git(...args: string[]): string {
  return execFileSync('git', ['-C', teamDir(), ...args], {
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

function repo(): void {
  git('init', '-q', '-b', 'main')
  writeFileSync(join(teamDir(), 'app.txt'), 'one\ntwo\n')
  git('add', '.')
  git('commit', '-qm', 'base')
}

test('the review reports changes since the pinned baseline', async () => {
  repo()
  writeFileSync(join(teamDir(), 'app.txt'), 'one\ntwo\nthree\n')
  const response = await teamsRouter.request(`/${env.teamId}/review`)
  expect(response.status).toBe(200)
  const body = (await response.json()) as RepositoryReviewResponse
  expect(body.teamId).toBe(env.teamId)
  expect(body.changes.identity).toMatchObject({ branch: 'main', headState: 'branch' })
  expect(body.changes.base).toEqual({
    requestedRef: 'HEAD',
    resolvedOid: git('rev-parse', 'HEAD'),
  })
  expect(body.changes.changes).toEqual([
    expect.objectContaining({ path: 'app.txt', status: 'modified', addedLines: 1, patch: null }),
  ])
  expect(response.headers.get('cache-control')).toBe('no-store')
})

test('patches are opt-in and bounded when requested', async () => {
  repo()
  writeFileSync(join(teamDir(), 'app.txt'), 'one\ntwo\nthree\n')
  const withPatches = await teamsRouter.request(`/${env.teamId}/review?patches=1`)
  const body = (await withPatches.json()) as RepositoryReviewResponse
  expect(body.changes.changes[0]?.patch).toContain('+three')
})

test('an unusable base is refused with a machine-readable code', async () => {
  repo()
  const injected = await teamsRouter.request(
    `/${env.teamId}/review?base=${encodeURIComponent('--upload-pack=/tmp/evil')}`,
  )
  expect(injected.status).toBe(400)
  expect((await injected.json()) as { code?: string }).toMatchObject({ code: 'invalid_base' })

  const unknown = await teamsRouter.request(`/${env.teamId}/review?base=no-such-branch`)
  expect(unknown.status).toBe(400)
  expect((await unknown.json()) as { code?: string }).toMatchObject({ code: 'unknown_base' })
})

test('a Team that is not a repository says so instead of returning an empty review', async () => {
  const response = await teamsRouter.request(`/${env.teamId}/review`)
  expect(response.status).toBe(409)
  expect((await response.json()) as { code?: string }).toMatchObject({ code: 'not_repository' })
})

test('an unknown Team is a 404, not a review of something else', async () => {
  const response = await teamsRouter.request('/missing-team/review')
  expect(response.status).toBe(404)
  expect((await response.json()) as { code?: string }).toMatchObject({ code: 'team_not_found' })
})

test('an operator capture stores a snapshot and returns its reference', async () => {
  repo()
  // The edit must differ in *length* from the committed `'one\\ntwo\\n'`. A same-size rewrite can
  // land in the same filesystem mtime tick, and git's stat cache then reports the entry clean — the
  // capture faithfully reports "nothing changed", and this test flakes. See the snapshot docs.
  writeFileSync(join(teamDir(), 'app.txt'), 'changed content\n')
  writeFileSync(join(teamDir(), 'notes.txt'), 'scratch\n')
  const response = await teamsRouter.request(`/${env.teamId}/review/snapshots`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ includeUntracked: ['notes.txt'] }),
  })
  expect(response.status).toBe(200)
  const body = (await response.json()) as SourceSnapshotResponse
  expect(body.snapshot.complete).toBe(true)
  expect(body.snapshot.untrackedIncluded).toEqual(['notes.txt'])
  expect(body.reference).toEqual({
    id: body.snapshot.id,
    complete: true,
    capturedAt: body.snapshot.capturedAt,
  })

  const list = (await (
    await teamsRouter.request(`/${env.teamId}/review/snapshots`)
  ).json()) as SourceSnapshotListResponse
  expect(list.snapshots).toEqual([
    expect.objectContaining({
      snapshotId: body.snapshot.id,
      capturedBy: 'operator',
      agentId: null,
      turnId: null,
      entryCount: 2,
    }),
  ])

  const one = await teamsRouter.request(`/${env.teamId}/review/snapshots/${body.snapshot.id}`)
  expect(one.status).toBe(200)
  expect(((await one.json()) as { snapshot: SourceSnapshot }).snapshot.id).toBe(body.snapshot.id)
})

test('an unknown snapshot id is a 404', async () => {
  repo()
  const response = await teamsRouter.request(`/${env.teamId}/review/snapshots/no-such-snapshot`)
  expect(response.status).toBe(404)
})

test('a snapshot reference means nothing in another Team', async () => {
  repo()
  const other = registerTeam(env.db, { id: 'other-team', name: 'other' }, env.paths)
  const captured = (await (
    await teamsRouter.request(`/${env.teamId}/review/snapshots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
  ).json()) as SourceSnapshotResponse
  expect(captured.reference.id).toBeTruthy()
  const across = await teamsRouter.request(`/${other.id}/review/snapshots/${captured.reference.id}`)
  expect(across.status).toBe(404)
  const listed = (await (
    await teamsRouter.request(`/${other.id}/review/snapshots`)
  ).json()) as SourceSnapshotListResponse
  expect(listed.snapshots).toEqual([])
})

test.each([
  ['an unexpected key', { base: 'HEAD', agentId: 'x' }],
  ['a non-array untracked selection', { includeUntracked: 'notes.txt' }],
  ['an over-long untracked path', { includeUntracked: ['x'.repeat(4097)] }],
  ['too many untracked paths', { includeUntracked: Array.from({ length: 1001 }, () => 'a') }],
  ['a non-string base', { base: 5 }],
])('a capture request with %s is refused', async (_label, body) => {
  repo()
  const response = await teamsRouter.request(`/${env.teamId}/review/snapshots`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(response.status).toBe(400)
})

test('a single-file diff is fetched without paying for the rest', async () => {
  repo()
  writeFileSync(join(teamDir(), 'app.txt'), 'one\ntwo\nthree\n')
  writeFileSync(join(teamDir(), 'other.txt'), 'new file\n')
  const response = await teamsRouter.request(
    `/${env.teamId}/review?patches=1&path=${encodeURIComponent('app.txt')}`,
  )
  const body = (await response.json()) as RepositoryReviewResponse
  const app = body.changes.changes.find((change) => change.path === 'app.txt')
  const other = body.changes.changes.find((change) => change.path === 'other.txt')
  expect(app?.patch).toContain('+three')
  // The unrequested file is still listed, but its content was never read.
  expect(other?.patch).toBeNull()
})

test('an empty or over-long path parameter is refused', async () => {
  repo()
  const empty = await teamsRouter.request(`/${env.teamId}/review?patches=1&path=`)
  expect(empty.status).toBe(400)
  const long = await teamsRouter.request(`/${env.teamId}/review?patches=1&path=${'x'.repeat(4097)}`)
  expect(long.status).toBe(400)
})

test('snapshot applicability is three-valued and conservative', async () => {
  repo()
  // Longer than the committed `'one\\ntwo\\n'`: see the note above on git's stat cache.
  writeFileSync(join(teamDir(), 'app.txt'), 'changed content\n')
  const captured = (await (
    await teamsRouter.request(`/${env.teamId}/review/snapshots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
  ).json()) as SourceSnapshotResponse
  const id = captured.reference.id

  const unchanged = await teamsRouter.request(`/${env.teamId}/review/snapshots/${id}/applicability`)
  expect(unchanged.status).toBe(200)
  expect(await unchanged.json()).toMatchObject({
    comparison: 'identical',
    reason: 'source_unchanged',
  })

  // A later edit makes the stored snapshot stale — but only "changed", never "failed".
  writeFileSync(join(teamDir(), 'app.txt'), 'changed again\n')
  expect(
    await (await teamsRouter.request(`/${env.teamId}/review/snapshots/${id}/applicability`)).json(),
  ).toMatchObject({ comparison: 'changed', reason: 'source_changed' })
})

test('applicability is unknown for a snapshot that is absent, and takes no new evidence', async () => {
  repo()
  const missing = await teamsRouter.request(
    `/${env.teamId}/review/snapshots/${'f'.repeat(64)}/applicability`,
  )
  expect(missing.status).toBe(200)
  expect(await missing.json()).toMatchObject({ comparison: 'unknown', reason: 'no_snapshot' })

  // The check captures the current state in memory only: it must not create a snapshot row.
  const listed = (await (
    await teamsRouter.request(`/${env.teamId}/review/snapshots`)
  ).json()) as SourceSnapshotListResponse
  expect(listed.snapshots).toEqual([])
})

test('feedback carries the reviewed snapshot, the path and a bounded excerpt', async () => {
  repo()
  writeFileSync(join(teamDir(), 'app.txt'), 'one\ntwo\nthree\n')
  const captured = (await (
    await teamsRouter.request(`/${env.teamId}/review/snapshots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
  ).json()) as SourceSnapshotResponse

  const response = await teamsRouter.request(`/${env.teamId}/review/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      path: 'app.txt',
      snapshotId: captured.reference.id,
      startLine: 2,
      endLine: 3,
      note: 'please keep the ordering here',
    }),
  })
  expect(response.status).toBe(200)
  const body = (await response.json()) as {
    feedback: {
      applicability: string
      lineRange: unknown
      excerpt: string | null
      excerptSource: string
      snapshotId: string | null
    }
    reference: string
    message: string
  }
  expect(body.feedback).toMatchObject({
    applicability: 'current',
    lineRange: { start: 2, end: 3 },
    excerptSource: 'current_read',
    snapshotId: captured.reference.id,
  })
  // The message is what actually crosses the chat ingress, so the identity travels inside it.
  expect(body.reference).toBe(`review-feedback:${captured.reference.id}:app.txt`)
  expect(body.message).toContain(`review-feedback:${captured.reference.id}`)
  expect(body.message).toContain('app.txt')
  expect(body.message).toContain('unchanged since this snapshot')
  expect(body.message).toContain('Selected lines: 2-3')
  expect(body.message).toContain('+three')
  expect(body.message).toContain('please keep the ordering here')
  // The excerpt is labelled as a fresh read, never presented as the snapshot's own bytes.
  expect(body.message).toContain('read now, not stored in the snapshot')
})

test('feedback against a superseded snapshot is marked stale, not silently retargeted', async () => {
  repo()
  writeFileSync(join(teamDir(), 'app.txt'), 'one\ntwo\nfirst revision\n')
  const captured = (await (
    await teamsRouter.request(`/${env.teamId}/review/snapshots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
  ).json()) as SourceSnapshotResponse

  // The file moves on after the snapshot was taken.
  writeFileSync(join(teamDir(), 'app.txt'), 'one\ntwo\nsecond revision\n')
  const response = await teamsRouter.request(`/${env.teamId}/review/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'app.txt', snapshotId: captured.reference.id }),
  })
  const body = (await response.json()) as { feedback: { applicability: string }; message: string }
  expect(body.feedback.applicability).toBe('stale')
  expect(body.message).toContain('CHANGED since this snapshot')
})

test('feedback without a snapshot claims no applicability at all', async () => {
  repo()
  writeFileSync(join(teamDir(), 'app.txt'), 'one\ntwo\nthree\n')
  const body = (await (
    await teamsRouter.request(`/${env.teamId}/review/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'app.txt' }),
    })
  ).json()) as { feedback: { applicability: string; snapshotId: string | null }; message: string }
  expect(body.feedback.applicability).toBe('unknown')
  expect(body.feedback.snapshotId).toBeNull()
  expect(body.message).toContain('unknown (no_snapshot)')
  expect(body.message).toContain('(not captured)')
})

test('feedback for an unchanged file is current even when the tree has other edits', async () => {
  repo()
  writeFileSync(join(teamDir(), 'other.txt'), 'new\n')
  const captured = (await (
    await teamsRouter.request(`/${env.teamId}/review/snapshots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
  ).json()) as SourceSnapshotResponse
  // The untouched file is still listed as untracked/added; asking about it must not be "stale"
  // merely because a different file was added after the snapshot.
  const body = (await (
    await teamsRouter.request(`/${env.teamId}/review/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'other.txt', snapshotId: captured.reference.id }),
    })
  ).json()) as { feedback: { applicability: string } }
  expect(body.feedback.applicability).toBe('current')
})

test.each([
  ['a path outside the change set', { path: 'not-changed.txt' }],
  ['an inverted line range', { path: 'app.txt', startLine: 5, endLine: 2 }],
  ['a non-integer line', { path: 'app.txt', startLine: 1.5 }],
  ['an unexpected key', { path: 'app.txt', agentId: 'x' }],
  ['an over-long note', { path: 'app.txt', note: 'x'.repeat(2001) }],
])('feedback with %s is refused', async (_label, payload) => {
  repo()
  writeFileSync(join(teamDir(), 'app.txt'), 'one\ntwo\nthree\n')
  const response = await teamsRouter.request(`/${env.teamId}/review/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  expect(response.status).toBe(400)
})
