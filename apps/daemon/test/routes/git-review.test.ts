import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RepositoryReviewResponse, ReviewFeedbackResponse } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createProfile, registerTeam, spawnAgent } from '../../src/core/index.ts'
import * as conversations from '../../src/core/repos/conversations.ts'
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
    agentId,
    comments: [{ path: 'app.txt', note: 'please keep the ordering here' }],
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
    (agentId: string) => ({ agentId, comments: [{ path: 'not-changed.txt' }] }),
    'That path is not changed since this baseline.',
  ],
  [
    'an Agent of another Team',
    () => ({ agentId: 'outsider', comments: [{ path: 'app.txt' }] }),
    'That Agent is not a member of this Team.',
  ],
  ['a missing Agent', () => ({ comments: [{ path: 'app.txt' }] }), undefined],
  ['no comments', (agentId: string) => ({ agentId, comments: [] }), undefined],
  [
    'a line that is not a line number',
    (agentId: string) => ({ agentId, comments: [{ path: 'app.txt', line: 0 }] }),
    undefined,
  ],
  [
    'an over-long note',
    (agentId: string) => ({
      agentId,
      comments: [{ path: 'app.txt', note: 'x'.repeat(2001) }],
    }),
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

test('a comment on a line carries the hunk around that line, and a review holds several', async () => {
  repo()
  const agentId = member()
  // Two hunks: one at the top of the file, one far below.
  const lines = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`)
  writeFileSync(join(teamDir(), 'app.txt'), `${lines.join('\n')}\n`)
  git('commit', '-qam', 'forty lines')
  lines[1] = 'line 2 changed'
  lines[36] = 'line 37 changed'
  writeFileSync(join(teamDir(), 'app.txt'), `${lines.join('\n')}\n`)
  writeFileSync(join(teamDir(), 'notes.md'), 'hello\n')

  const single = await feedback({
    agentId,
    comments: [{ path: 'app.txt', line: 37, note: 'not this wording' }],
  })
  const one = (await single.json()) as ReviewFeedbackResponse
  expect(one.message).toContain('Review feedback on app.txt, line 37 (modified since HEAD')
  expect(one.message).toContain('+line 37 changed')
  expect(one.message).not.toContain('+line 2 changed')

  const several = await feedback({
    agentId,
    note: 'two things before we ship',
    comments: [
      { path: 'app.txt', line: 2, note: 'keep the old text' },
      { path: 'notes.md', note: 'move this to the docs folder' },
    ],
  })
  expect(several.status).toBe(202)
  const review = (await several.json()) as ReviewFeedbackResponse
  expect(review.message).toContain('Review feedback: 2 comments (since HEAD')
  expect(review.message).toContain('two things before we ship')
  expect(review.message).toContain('1. app.txt, line 2 (modified)')
  expect(review.message).toContain('+line 2 changed')
  expect(review.message).toContain('2. notes.md (untracked)')
  // One review is one queued turn.
  expect(queue.list(env.db, agentId).items).toHaveLength(2)
})

/** A conversation of `agentId` whose transcript holds the given tool calls. */
function conversationWith(
  agentId: string,
  calls: Array<{ id: string; name: string; path: string; failed?: boolean; at: string }>,
): string {
  const id = randomUUID()
  const sessions = join(env.paths.agentDir(agentId), 'sessions')
  mkdirSync(sessions, { recursive: true })
  const entries: object[] = [{ type: 'session', version: 3, id, cwd: teamDir() }]
  for (const call of calls) {
    entries.push({
      type: 'message',
      timestamp: call.at,
      message: {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: call.id, name: call.name, arguments: { path: call.path } },
        ],
      },
    })
    entries.push({
      type: 'message',
      timestamp: call.at,
      message: { role: 'toolResult', toolCallId: call.id, isError: call.failed === true },
    })
  }
  writeFileSync(
    join(sessions, `${id}.jsonl`),
    `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`,
  )
  conversations.create(env.db, agentId, id)
  return id
}

test('authors name the Agent whose file tool last wrote each changed path', async () => {
  repo()
  const first = member()
  createProfile(env.db, env.paths, { id: 'second-writer', defaultModel: 'lmstudio:test' })
  const second = spawnAgent(env.db, env.paths, {
    profileId: 'second-writer',
    teamId: env.teamId,
    name: 'Second',
  }).id
  writeFileSync(join(teamDir(), 'app.txt'), 'one\ntwo\nthree\n')
  writeFileSync(join(teamDir(), 'notes.md'), 'hello\n')
  writeFileSync(join(teamDir(), 'by-shell.txt'), 'made by a command\n')
  conversationWith(first, [
    { id: 'c1', name: 'write', path: 'app.txt', at: '2026-11-19T10:00:00.000Z' },
    // A failed write and a read are nobody's change.
    { id: 'c2', name: 'edit', path: 'notes.md', failed: true, at: '2026-11-19T10:01:00.000Z' },
    { id: 'c3', name: 'read', path: 'by-shell.txt', at: '2026-11-19T10:02:00.000Z' },
  ])
  const later = conversationWith(second, [
    // An absolute path inside the workspace counts, and the later write wins.
    {
      id: 'c4',
      name: 'edit',
      path: join(teamDir(), 'app.txt'),
      at: '2026-11-19T11:00:00.000Z',
    },
    { id: 'c5', name: 'write', path: '../outside.txt', at: '2026-11-19T11:01:00.000Z' },
  ])

  const plain = await teamReviewRouter.request(`/${env.teamId}/review`)
  expect(((await plain.json()) as RepositoryReviewResponse).authors).toBeUndefined()

  const response = await teamReviewRouter.request(`/${env.teamId}/review?authors=1`)
  const body = (await response.json()) as RepositoryReviewResponse
  expect(body.authors).toEqual({
    'app.txt': {
      agentId: second,
      agentName: 'Second',
      conversationId: later,
      at: Date.parse('2026-11-19T11:00:00.000Z'),
    },
  })
})
