import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkspaceRecoveryResponse } from '@bazilion/api-types'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createClient } from '../../../../packages/client/src/index.ts'
import { openInMemoryDb } from '../../src/core/db/client.ts'
import { runMigrations } from '../../src/core/db/migrate.ts'
import { resolvePaths } from '../../src/core/paths.ts'
import { registerTeam } from '../../src/core/team/register.ts'
import { workspaceLifecycle } from '../../src/lib/coding-environment/lifecycle.ts'

let context: { db: ReturnType<typeof openInMemoryDb>; paths: ReturnType<typeof resolvePaths> }
let home: string
vi.mock('../../src/lib/ctx.ts', () => ({ getCtx: () => context }))
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'recovery-http-'))
  context = { db: openInMemoryDb(), paths: resolvePaths(home) }
  runMigrations(context.db)
  registerTeam(context.db, { id: 'one' }, context.paths)
  registerTeam(context.db, { id: 'two' }, context.paths)
})
afterEach(() => {
  context.db.close()
  rmSync(home, { recursive: true, force: true })
})

test('production middleware denies unauthenticated and non-admin recovery requests before cleanup', async () => {
  const { teamsRouter } = await import('../../src/routes/teams.ts')
  const { authMiddleware } = await import('../../src/lib/middleware-auth.ts')
  const { create } = await import('../../src/core/repos/webTokens.ts')
  const app = new Hono().use('*', authMiddleware).route('/api/teams', teamsRouter)
  const token = create(context.db, 'fixture-device', {
    scopes: ['read', 'write', 'approvals'],
  }).token
  for (const [method, path] of [
    ['GET', '/api/teams/one/workspace/recovery'],
    ['POST', '/api/teams/one/workspace/recovery/opaque-writer'],
  ]) {
    expect((await app.request(path as string, { method })).status).toBe(401)
    const refused = await app.request(path as string, {
      method,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(refused.status).toBe(403)
    expect(await refused.json()).toMatchObject({
      code: 'insufficient_scope',
      requiredScope: 'admin',
    })
  }
})

test('bounded report and selection expose no ownership internals; body substitution and wrong Team refuse', async () => {
  const { teamsRouter } = await import('../../src/routes/teams.ts')
  const lifecycle = workspaceLifecycle(context.db)
  const lease = lifecycle.coordinator.claim('one', context.paths.teamDir('one'), 'agent')
  const report = await (await teamsRouter.request('/one/workspace/recovery')).json()
  expect(report).toEqual({
    teamId: 'one',
    truncated: false,
    writers: [{ writerId: lease.writer.id, posture: 'active' }],
  })
  expect(JSON.stringify(report)).not.toContain(home)
  expect((await teamsRouter.request('/one/workspace/recovery')).headers.get('cache-control')).toBe(
    'no-store',
  )
  const active = await teamsRouter.request(`/one/workspace/recovery/${lease.writer.id}`, {
    method: 'POST',
  })
  expect(((await active.json()) as WorkspaceRecoveryResponse).outcome).toBe('active')
  const wrong = await teamsRouter.request(`/two/workspace/recovery/${lease.writer.id}`, {
    method: 'POST',
  })
  expect(((await wrong.json()) as WorkspaceRecoveryResponse).outcome).toBe('not_found')
  expect(
    (
      await teamsRouter.request(`/one/workspace/recovery/${lease.writer.id}`, {
        method: 'POST',
        body: JSON.stringify({ pid: process.pid, cleanupConfirmed: true }),
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await teamsRouter.request(`/one/workspace/recovery/${lease.writer.id}`, {
        method: 'POST',
        headers: { 'content-length': '1' },
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await teamsRouter.request(`/one/workspace/recovery/${lease.writer.id}`, {
        method: 'POST',
        headers: { 'content-length': '0' },
        body: '{"cleanupConfirmed":true}',
      })
    ).status,
  ).toBe(400)
  lease.finish(true)
})

test('real HTTP client settles previously confirmed records and admits the same Team root', async () => {
  const { teamsRouter } = await import('../../src/routes/teams.ts')
  const { authMiddleware } = await import('../../src/lib/middleware-auth.ts')
  const { create } = await import('../../src/core/repos/webTokens.ts')
  const { providerModelRepo, providerStateRepo } = await import('../../src/core/index.ts')
  providerStateRepo.setEnabled(context.db, 'lmstudio', true)
  providerModelRepo.replace(context.db, 'lmstudio', ['fixture-model'])
  const token = create(context.db, 'fixture-admin', { scopes: ['admin'] }).token
  const lifecycle = workspaceLifecycle(context.db)
  const root = context.paths.teamDir('one')
  const lease = lifecycle.coordinator.claim('one', root, 'agent')
  // Model a previously confirmed resource record, not actual Docker execution.
  lease.attach({ id: 'confirmed-record', kind: 'container' })
  context.db.raw.run(
    "INSERT INTO workspace_resources(id,writer_id,kind,identity_json,cleanup_confirmed) VALUES(?,?,'container','{}',1)",
    ['confirmed-record', lease.writer.id],
  )
  lease.finish(false)
  const app = new Hono().use('*', authMiddleware).route('/api/teams', teamsRouter)
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
  try {
    if (!server.listening) await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture listener')
    const client = createClient({ serverUrl: `http://127.0.0.1:${address.port}`, token })
    expect((await client.workspaceRecovery('one').list()).writers).toHaveLength(1)
    expect((await client.workspaceRecovery('two').attempt(lease.writer.id)).outcome).toBe(
      'not_found',
    )
    const result = await client.workspaceRecovery('one').attempt(lease.writer.id)
    expect(result).toEqual({
      outcome: 'recovered',
      report: { teamId: 'one', truncated: false, writers: [] },
    })
    expect((await client.workspaceRecovery('one').attempt(lease.writer.id)).outcome).toBe(
      'not_found',
    )
    lifecycle.coordinator.claim('one', root, 'agent').finish(true)
    expect(JSON.stringify(result)).not.toContain(home)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
