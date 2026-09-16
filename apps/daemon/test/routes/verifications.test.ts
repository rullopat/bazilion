import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { VerificationBlockedResponse, VerificationResponse } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { setRequestState } from '../../src/core/repos/verification-requests.ts'
import { teamsRouter } from '../../src/routes/teams.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

// BAZ-044 slice 6: the operator API for verification requests.

let env: TestEnv
vi.mock('../../src/lib/ctx.ts', () => ({
  getCtx: () => ({ db: env.db, paths: env.paths, authToken: 'test-only' }),
}))

beforeEach(() => {
  env = makeTestEnv()
  env.db.raw.run(
    "INSERT INTO profiles (id,name,dir,default_model,created_at,updated_at) VALUES ('profile','Profile','p','lmstudio:model',1,1)",
  )
  for (const id of ['coder', 'tester']) {
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
  const body = (await response.json()) as { reference: { id: string } }
  return body.reference.id
}

async function create(snapshot: string, overrides: Record<string, unknown> = {}) {
  return teamsRouter.request(`/${env.teamId}/verifications`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      recipientAgentId: 'tester',
      snapshotId: snapshot,
      checks: [{ command: 'pnpm test', cwd: '.', purpose: 'suite', timeoutMs: 60_000 }],
      summary: 'verify the fix',
      ...overrides,
    }),
  })
}

test('an operator captures a request and reads it back with its evidence', async () => {
  const snapshot = await snapshotId()
  const created = await create(snapshot)
  expect(created.status).toBe(201)
  const body = (await created.json()) as VerificationResponse
  const id = body.request.request.id
  expect(body.request.request).toMatchObject({
    state: 'pending',
    requester: { kind: 'operator' },
    recipientAgentId: 'tester',
  })
  expect(body.request.checks).toEqual([
    { ordinal: 0, command: 'pnpm test', cwd: '.', purpose: 'suite', timeoutMs: 60_000 },
  ])
  // Nothing has run, and applicability is a comparison rather than a pass.
  expect(body.request.attempts).toEqual([])
  expect(body.request.applicability).toMatchObject({ comparison: 'identical' })

  const listed = await teamsRouter.request(`/${env.teamId}/verifications`)
  const list = (await listed.json()) as { requests: unknown[] }
  expect(list.requests).toHaveLength(1)

  const shown = await teamsRouter.request(`/${env.teamId}/verifications/${id}`)
  expect(((await shown.json()) as VerificationResponse).request.request.id).toBe(id)
  // A Team-scoped read never leaks another Team's request.
  const elsewhere = await teamsRouter.request(`/other-team/verifications/${id}`)
  expect(elsewhere.status).toBeGreaterThanOrEqual(400)
})

test('a capture that cannot be honoured comes back as a blocker, not a crash', async () => {
  const snapshot = await snapshotId()
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ snapshotId: 'never-captured' }, 'snapshot_unavailable'],
    [{ recipientAgentId: 'missing' }, 'recipient_unavailable'],
    [{ checks: [] }, 'unsupported'],
  ]
  for (const [override, reason] of cases) {
    const response = await create(snapshot, override)
    expect(response.status, JSON.stringify(override)).toBe(409)
    const body = (await response.json()) as VerificationBlockedResponse
    expect(body.blocked.reason, JSON.stringify(override)).toBe(reason)
    expect(body.blocked.detail.length).toBeGreaterThan(0)
  }
  // A malformed body is refused before anything is read.
  const malformed = await teamsRouter.request(`/${env.teamId}/verifications`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ recipientAgentId: 'tester' }),
  })
  expect(malformed.status).toBe(400)
})

test('a pending request can be cancelled, and a finished one cannot', async () => {
  const snapshot = await snapshotId()
  const created = await create(snapshot)
  const id = ((await created.json()) as VerificationResponse).request.request.id
  const cancelled = await teamsRouter.request(`/${env.teamId}/verifications/${id}/cancel`, {
    method: 'POST',
  })
  expect(cancelled.status).toBe(200)
  expect(((await cancelled.json()) as VerificationResponse).request.request.state).toBe('cancelled')
  // Cancelling again is refused as a state conflict rather than silently repeated.
  const again = await teamsRouter.request(`/${env.teamId}/verifications/${id}/cancel`, {
    method: 'POST',
  })
  expect(again.status).toBe(409)
  // Cancelling an unknown request is a 404.
  const missing = await teamsRouter.request(`/${env.teamId}/verifications/nope/cancel`, {
    method: 'POST',
  })
  expect(missing.status).toBe(404)
})

test('an unknown request reads as 404 and no-cache everywhere', async () => {
  const missing = await teamsRouter.request(`/${env.teamId}/verifications/missing`)
  expect(missing.status).toBe(404)
  expect(missing.headers.get('cache-control')).toBe('no-store')
})

test('a held request can be cancelled, not just a pending one (review S7b)', async () => {
  const snapshot = await snapshotId()
  const created = await create(snapshot)
  const id = ((await created.json()) as VerificationResponse).request.request.id
  // The state a request reaches when its edge requires approval.
  setRequestState(env.db, id, 'awaiting_approval')
  const cancelled = await teamsRouter.request(`/${env.teamId}/verifications/${id}/cancel`, {
    method: 'POST',
  })
  expect(cancelled.status).toBe(200)
  expect(((await cancelled.json()) as VerificationResponse).request.request.state).toBe('cancelled')
})
