import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { openInMemoryDb } from '../../src/core/db/client.ts'
import { runMigrations } from '../../src/core/db/migrate.ts'
import { putCodingEnvironment } from '../../src/core/repos/coding-environment.ts'
import { workspaceLifecycle } from '../../src/lib/coding-environment/lifecycle.ts'
import { WorkspaceCoordinator } from '../../src/lib/coding-environment/workspace.ts'

let root: string
let db: ReturnType<typeof openInMemoryDb>
let coordinator: WorkspaceCoordinator
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'baz-workspace-'))
  mkdirSync(join(root, 'child'))
  mkdirSync(join(root, 'sibling'))
  db = openInMemoryDb()
  runMigrations(db)
  for (const id of ['one', 'two'])
    db.raw.run('INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)', [id, id, Date.now()])
  coordinator = new WorkspaceCoordinator(db)
})
afterEach(() => {
  db.close()
  rmSync(root, { recursive: true, force: true })
})
function enable(id: string) {
  putCodingEnvironment(db, id, 0, {
    image: 'node:24',
    cwd: '.',
    env: {},
  })
}

test('unconfigured Teams serialize shared-workspace writers without any setup toggle', () => {
  const first = coordinator.claim('one', root, 'agent')
  expect(() => coordinator.claim('two', root, 'agent')).toThrow('workspace_busy')
  first.finish(true)
  coordinator.claim('two', root, 'agent').finish(true)
})

test('enabled Team excludes equal, descendant, ancestor and aliased roots across Agents', () => {
  enable('one')
  const first = coordinator.claim('one', join(root, 'child'), 'agent')
  symlinkSync(join(root, 'child'), join(root, 'alias'))
  for (const path of [root, join(root, 'child'), join(root, 'alias')]) {
    expect(() => coordinator.claim('two', path, 'agent')).toThrow('workspace_busy')
  }
  coordinator.claim('two', join(root, 'sibling'), 'agent').finish(true)
  first.finish(true)
  coordinator.claim('two', root, 'agent').finish(true)
})

test('enabling cannot race an existing disabled-Team writer through its mutation claim', () => {
  const writer = coordinator.claim('two', root, 'agent')
  expect(() => coordinator.claim('one', root, 'mutation')).toThrow('workspace_busy')
  writer.finish(true)
  const mutation = coordinator.claim('one', root, 'mutation')
  enable('one')
  expect(() => coordinator.claim('two', root, 'agent')).toThrow('workspace_busy')
  mutation.finish(true)
})

test('failed teardown remains blocking and recovery never releases ownership on a failed confirmation', async () => {
  const lease = coordinator.claim('one', root, 'agent')
  lease.attach({ kind: 'container', id: 'durable-container-reference' })
  lease.finish(false)
  expect(() => coordinator.claim('two', root, 'agent')).toThrow('workspace_recovery_required')
  const [abandoned] = coordinator.recoveryRequired()
  expect(abandoned?.resources).toEqual([{ kind: 'container', id: 'durable-container-reference' }])
  expect(await coordinator.recover(lease.writer.id, async () => false)).toBe(false)
  expect(() => coordinator.claim('two', root, 'agent')).toThrow('workspace_recovery_required')
  expect(await coordinator.recover(lease.writer.id, async () => true)).toBe(true)
  coordinator.claim('two', root, 'agent').finish(true)
})

test('restart preserves even disabled-Team ownership and blocks throughout asynchronous recovery', async () => {
  const lease = coordinator.claim('one', root, 'agent')
  lease.attach({ kind: 'worker', id: 'durable-worker-reference' })
  const restarted = new WorkspaceCoordinator(db)
  expect(restarted.recoveryRequired()).toHaveLength(1)
  expect(() => restarted.claim('two', root, 'agent')).toThrow('workspace_recovery_required')
  let confirm!: (value: boolean) => void
  const recovery = restarted.recover(
    lease.writer.id,
    () =>
      new Promise((resolve) => {
        confirm = resolve
      }),
  )
  expect(() => restarted.claim('two', root, 'agent')).toThrow('workspace_recovery_required')
  confirm(true)
  await recovery
  restarted.claim('two', root, 'agent').finish(true)
})

test('active leases cannot be recovered and repeated release cannot erase a later writer', async () => {
  const first = coordinator.claim('one', root, 'agent')
  await expect(coordinator.recover(first.writer.id, async () => true)).rejects.toThrow(
    'workspace_busy',
  )
  first.finish(true)
  const second = coordinator.claim('one', root, 'agent')
  first.finish(true)
  expect(() => coordinator.claim('two', root, 'agent')).toThrow('workspace_busy')
  expect(() => first.attach({ kind: 'worker', id: 'late' })).toThrow('no longer active')
  second.finish(true)
})

test('deletion does not silently cascade an unconfirmed writer record', () => {
  const first = coordinator.claim('one', root, 'agent')
  first.finish(false)
  db.raw.run('DELETE FROM teams WHERE id = ?', ['one'])
  expect(coordinator.recoveryRequired()).toHaveLength(1)
  expect(() => coordinator.claim('two', root, 'agent')).toThrow('workspace_recovery_required')
})

test('container registration is restricted to the writer namespace and admitted Docker identity', async () => {
  const lifecycle = workspaceLifecycle(db)
  const lease = await lifecycle.claim('one', root, 'agent')
  const engine = {
    dockerPath: '/usr/bin/docker',
    endpoint: 'unix:///var/run/docker.sock',
    executableIdentity: {
      device: '1',
      inode: '2',
      mode: '33261',
      size: '3',
      modifiedTimeNs: '4',
      changedTimeNs: '5',
    },
  }
  const containers = lifecycle.containers(lease, engine)
  await expect(
    containers.beforeCreate({ ...engine, containerName: 'bazilion-another-turn-container' }),
  ).rejects.toThrow('Invalid turn container')
  const name = containers.name('bash')
  await expect(
    containers.beforeCreate({ ...engine, dockerPath: '/tmp/untrusted', containerName: name }),
  ).rejects.toThrow('does not match')
  await containers.beforeCreate({ ...engine, containerName: name })
  expect(
    db.raw.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM workspace_resources').get()
      ?.count,
  ).toBe(1)
  await expect(containers.beforeCreate({ ...engine, containerName: name })).rejects.toThrow(
    'Invalid turn container',
  )
  await expect(containers.afterRemove('bazilion-another-turn-container')).rejects.toThrow(
    'cleanup unconfirmed',
  )
})
