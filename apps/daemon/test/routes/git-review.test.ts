import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RepositoryReviewResponse, ReviewFeedbackResponse } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createProfile, registerTeam, spawnAgent } from '../../src/core/index.ts'
import * as queue from '../../src/core/repos/user-queue.ts'
import { teamReviewRouter } from '../../src/routes/team-review.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'
import { runGit } from '../fixtures/git.ts'

// BAZ-042: Team-scoped review and file feedback routes.

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

const git = (...args: string[]) => runGit(teamDir(), env.home, ...args)

function repo(): void {
  git('init', '-q', '-b', 'main')
  writeFileSync(join(teamDir(), 'app.txt'), 'one\ntwo\n')
  git('add', '.')
  git('commit', '-qm', 'base')
}

test('the review reports changes since the pinned baseline', async () => {
  repo()
  writeFileSync(join(teamDir(), 'app.txt'), 'one\ntwo\nthree\n')
  const response = await teamReviewRouter.request(`/${env.teamId}/review`)
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
})

test('patches are opt-in and bounded when requested', async () => {
  repo()
  writeFileSync(join(teamDir(), 'app.txt'), 'one\ntwo\nthree\n')
  const withPatches = await teamReviewRouter.request(`/${env.teamId}/review?patches=1`)
  const body = (await withPatches.json()) as RepositoryReviewResponse
  expect(body.changes.changes[0]?.patch).toContain('+three')
})

test('an unusable base is refused with a machine-readable code', async () => {
  repo()
  const injected = await teamReviewRouter.request(
    `/${env.teamId}/review?base=${encodeURIComponent('--upload-pack=/tmp/evil')}`,
  )
  expect(injected.status).toBe(400)
  expect((await injected.json()) as { code?: string }).toMatchObject({ code: 'invalid_base' })

  const unknown = await teamReviewRouter.request(`/${env.teamId}/review?base=no-such-branch`)
  expect(unknown.status).toBe(400)
  expect((await unknown.json()) as { code?: string }).toMatchObject({ code: 'unknown_base' })
})

test('a Team that is not a repository says so instead of returning an empty review', async () => {
  const response = await teamReviewRouter.request(`/${env.teamId}/review`)
  expect(response.status).toBe(409)
  expect((await response.json()) as { code?: string }).toMatchObject({ code: 'not_repository' })
})

test('an unknown Team is a 404, not a review of something else', async () => {
  const response = await teamReviewRouter.request('/missing-team/review')
  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({ error: 'Team not found.' })
})

test('a single-file diff is fetched without paying for the rest', async () => {
  repo()
  writeFileSync(join(teamDir(), 'app.txt'), 'one\ntwo\nthree\n')
  writeFileSync(join(teamDir(), 'other.txt'), 'new file\n')
  const response = await teamReviewRouter.request(
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
  const empty = await teamReviewRouter.request(`/${env.teamId}/review?patches=1&path=`)
  expect(empty.status).toBe(400)
  const long = await teamReviewRouter.request(
    `/${env.teamId}/review?patches=1&path=${'x'.repeat(4097)}`,
  )
  expect(long.status).toBe(400)
})

test('a new untracked file is shown as an added-file diff', async () => {
  repo()
  writeFileSync(join(teamDir(), 'notes.md'), 'first line\nsecond line\n')
  const response = await teamReviewRouter.request(
    `/${env.teamId}/review?patches=1&path=${encodeURIComponent('notes.md')}`,
  )
  const body = (await response.json()) as RepositoryReviewResponse
  const notes = body.changes.changes.find((change) => change.path === 'notes.md')
  expect(notes).toMatchObject({ status: 'untracked', contentOmitted: null })
  expect(notes?.patch).toContain('new file mode')
  expect(notes?.patch).toContain('+++ b/notes.md')
  expect(notes?.patch).toContain('+second line')
})

test('revision syntax works as a comparison base', async () => {
  repo()
  writeFileSync(join(teamDir(), 'app.txt'), 'one\ntwo\nthree\n')
  git('commit', '-qam', 'second')
  const response = await teamReviewRouter.request(
    `/${env.teamId}/review?base=${encodeURIComponent('HEAD~1')}`,
  )
  expect(response.status).toBe(200)
  const body = (await response.json()) as RepositoryReviewResponse
  expect(body.changes.base.resolvedOid).toBe(git('rev-parse', 'HEAD~1'))
  expect(body.changes.changes).toEqual([
    expect.objectContaining({ path: 'app.txt', status: 'modified' }),
  ])
})

function member(teamId = env.teamId): string {
  createProfile(env.db, env.paths, { id: `reviewer-${teamId}`, defaultModel: 'lmstudio:test' })
  return spawnAgent(env.db, env.paths, { profileId: `reviewer-${teamId}`, teamId }).id
}

function feedback(payload: unknown): Promise<Response> {
  return Promise.resolve(
    teamReviewRouter.request(`/${env.teamId}/review/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
}

test('feedback queues the file, its change, a diff excerpt and the note for an Agent', async () => {
  repo()
  const agentId = member()
  writeFileSync(join(teamDir(), 'app.txt'), 'one\ntwo\nthree\n')
  const response = await feedback({
    path: 'app.txt',
    agentId,
    note: 'please keep the ordering here',
  })
  expect(response.status).toBe(202)
  const body = (await response.json()) as ReviewFeedbackResponse
  expect(body.message).toContain('app.txt (modified since HEAD')
  expect(body.message).toContain('please keep the ordering here')
  expect(body.message).toContain('+three')
  // The queued input is exactly the message the operator was shown.
  expect(queue.get(env.db, agentId, body.item.id)?.text).toBe(body.message)
})

test.each([
  [
    'a path outside the change set',
    (agentId: string) => ({ path: 'not-changed.txt', agentId }),
    'That path is not changed since this baseline.',
  ],
  [
    'an Agent of another Team',
    () => ({ path: 'app.txt', agentId: 'outsider' }),
    'That Agent is not a member of this Team.',
  ],
  ['a missing Agent', () => ({ path: 'app.txt' }), undefined],
  [
    'an over-long note',
    (agentId: string) => ({ path: 'app.txt', agentId, note: 'x'.repeat(2001) }),
    undefined,
  ],
])('feedback with %s is refused', async (_label, payload, error) => {
  repo()
  const agentId = member()
  const other = registerTeam(env.db, { id: 'other-team' }, env.paths)
  createProfile(env.db, env.paths, { id: 'outsider-profile', defaultModel: 'lmstudio:test' })
  spawnAgent(env.db, env.paths, {
    profileId: 'outsider-profile',
    teamId: other.id,
    name: 'outsider',
  })
  writeFileSync(join(teamDir(), 'app.txt'), 'one\ntwo\nthree\n')
  const response = await feedback(payload(agentId))
  expect(response.status).toBe(400)
  if (error) expect(await response.json()).toEqual({ error })
  expect(queue.list(env.db, agentId).items).toEqual([])
})
