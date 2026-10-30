import type { ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { openInMemoryDb } from '../../src/core/db/client.ts'
import { runMigrations } from '../../src/core/db/migrate.ts'
import { WorkspaceResources } from '../../src/lib/coding-environment/resources.ts'
import { WorkspaceCoordinator } from '../../src/lib/coding-environment/workspace.ts'
import { OwnedLinuxNamespace } from '../../src/lib/process/linux-domain.ts'
import * as docker from '../../src/runtime/shell/docker.ts'
import * as workers from '../../src/runtime/worker/process-identity.ts'

let root: string,
  db: ReturnType<typeof openInMemoryDb>,
  coordinator: WorkspaceCoordinator,
  resources: WorkspaceResources
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'native-intent-metadata-'))
  db = openInMemoryDb()
  runMigrations(db)
  db.raw.run('INSERT INTO teams(id,name,created_at) VALUES(?,?,?)', ['one', 'one', 1])
  coordinator = new WorkspaceCoordinator(db)
  resources = new WorkspaceResources(db)
})
afterEach(() => {
  // Metadata-only tests never launch a native process; no live writer/scratch is discarded.
  vi.restoreAllMocks()
  db.close()
  rmSync(root, { recursive: true })
})
const definition = 'd'.repeat(64)

test('native intent uses the canonical worker resource before spawn, with no PID authority', () => {
  const lease = coordinator.claim('one', root, 'agent')
  const registration = resources.registerNativeIntent(lease, 'linux-bwrap', definition)
  const row = db.raw
    .query<{ identity_json: string; kind: string; creation_acknowledged: number }, [string]>(
      'SELECT * FROM workspace_resources WHERE id = ?',
    )
    .get(registration.id)
  expect(row?.kind).toBe('worker')
  expect(row?.creation_acknowledged).toBe(0)
  expect(JSON.parse(row?.identity_json ?? '{}')).toEqual(registration.identity)
  expect(Object.keys(registration.identity).sort()).toEqual([
    'backend',
    'definition',
    'hostCommands',
    'kind',
    'token',
  ])
  expect(() => resources.beginNativeSpawn({ ...registration })).toThrow('registration unavailable')
  resources.cancelNativeBeforeSpawn(registration)
  expect(() => resources.beginNativeSpawn(registration)).toThrow('registration unavailable')
})

test('the spawn fence is one-use; attempted but unacknowledged creation stays blocked', async () => {
  const lease = coordinator.claim('one', root, 'agent')
  const registration = resources.registerNativeIntent(lease, 'linux-bwrap', definition)
  resources.beginNativeSpawn(registration)
  expect(() => resources.beginNativeSpawn(registration)).toThrow('consumed')
  expect(() => resources.cancelNativeBeforeSpawn(registration)).toThrow('uncertain')
  expect(await resources.cleanupResource(registration.id)).toBe(false)
  lease.finish(false)
  expect(await coordinator.recover(lease.writer.id, (writer) => resources.teardown(writer))).toBe(
    false,
  )
  expect(() => coordinator.claim('one', root, 'agent')).toThrow('workspace_recovery_required')
})

test('positive pre-spawn cancellation permits canonical teardown without any process lookup', async () => {
  const lease = coordinator.claim('one', root, 'agent')
  const registration = resources.registerNativeIntent(lease, 'linux-bwrap', definition)
  lease.finish(false)
  resources.cancelNativeBeforeSpawn(registration)
  expect(await coordinator.recover(lease.writer.id, (writer) => resources.teardown(writer))).toBe(
    true,
  )
  coordinator.claim('one', root, 'agent').finish(true)
})

test.each([
  'root_identity',
  'resources_json',
] as const)('changed writer %s revokes the native registration before spawn', (column) => {
  const lease = coordinator.claim('one', root, 'agent')
  const registration = resources.registerNativeIntent(lease, 'linux-bwrap', definition)
  db.raw.run(`UPDATE workspace_writers SET ${column} = ? WHERE id = ?`, [
    column === 'resources_json' ? '[]' : 'changed',
    lease.writer.id,
  ])
  expect(() => resources.beginNativeSpawn(registration)).toThrow('changed')
  expect(() => resources.cancelNativeBeforeSpawn(registration)).toThrow('changed')
})

test('JSON receipts cannot construct or bind a native owner', () => {
  const lease = coordinator.claim('one', root, 'agent')
  const registration = resources.registerNativeIntent(lease, 'linux-bwrap', definition)
  resources.beginNativeSpawn(registration)
  const receipt = JSON.parse(
    JSON.stringify({ kind: 'owned-linux-pid-domain', token: registration.identity.token }),
  )
  expect(
    () => new OwnedLinuxNamespace(receipt as ChildProcess, '11111111-1111-4111-8111-111111111111'),
  ).toThrow('ownership unavailable')
  expect(() => resources.bindNativeOwner(registration, receipt as OwnedLinuxNamespace)).toThrow(
    'ownership unavailable',
  )
  expect(() => resources.acknowledgeNativeCreation(registration)).toThrow('ownership unavailable')
})

test('a substituted native row never falls through to legacy worker or container signalling', async () => {
  const lease = coordinator.claim('one', root, 'agent')
  const registration = resources.registerNativeIntent(lease, 'linux-bwrap', definition)
  resources.beginNativeSpawn(registration)
  const worker = vi.spyOn(workers, 'terminateWorkerProcess').mockResolvedValue(true)
  const container = vi.spyOn(docker, 'terminateRecordedContainer').mockResolvedValue(true)
  db.raw.run('UPDATE workspace_resources SET identity_json = ? WHERE id = ?', [
    JSON.stringify({ pid: 123, startTicks: '1', uid: 0, bootId: 'synthetic' }),
    registration.id,
  ])
  expect(await resources.cleanupResource(registration.id)).toBe(false)
  db.raw.run(
    "UPDATE workspace_resources SET kind = 'container', identity_json = '{}' WHERE id = ?",
    [registration.id],
  )
  expect(await resources.cleanupResource(registration.id)).toBe(false)
  expect(worker).not.toHaveBeenCalled()
  expect(container).not.toHaveBeenCalled()
})

test('restored or externally changed creation records cannot start or acknowledge a launch', async () => {
  const lease = coordinator.claim('one', root, 'agent')
  const registration = resources.registerNativeIntent(lease, 'linux-bwrap', definition)
  db.raw.run('UPDATE workspace_resources SET creation_acknowledged = 1 WHERE id = ?', [
    registration.id,
  ])
  expect(() => resources.beginNativeSpawn(registration)).toThrow('registration changed')
  expect(await resources.cleanupResource(registration.id)).toBe(false)
  db.raw.run("UPDATE workspace_writers SET recovery_mode = 'restored' WHERE id = ?", [
    lease.writer.id,
  ])
  expect(() => resources.cancelNativeBeforeSpawn(registration)).toThrow('registration changed')
  expect(await resources.cleanupResource(registration.id)).toBe(false)
})
