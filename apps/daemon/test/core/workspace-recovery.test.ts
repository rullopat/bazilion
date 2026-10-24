import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { openDb, openInMemoryDb } from '../../src/core/db/client.ts'
import { runMigrations } from '../../src/core/db/migrate.ts'
import { workspaceLifecycle } from '../../src/lib/coding-environment/lifecycle.ts'
import { WorkspaceRecovery } from '../../src/lib/coding-environment/recovery.ts'
import { WorkspaceCoordinator } from '../../src/lib/coding-environment/workspace.ts'
import * as docker from '../../src/runtime/shell/docker.ts'

let root: string
let db: ReturnType<typeof openInMemoryDb>
let coordinator: WorkspaceCoordinator
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'recovery-service-'))
  db = openInMemoryDb()
  runMigrations(db)
  for (const id of ['one', 'two'])
    db.raw.run('INSERT INTO teams(id,name,created_at) VALUES(?,?,?)', [id, id, 1])
  coordinator = new WorkspaceCoordinator(db)
})
afterEach(() => {
  db.close()
  rmSync(root, { recursive: true, force: true })
})

test('management selection refuses wrong Team, active lease, restored authority and legacy host escape', async () => {
  const lease = coordinator.claim('one', root, 'agent')
  const teardown = vi.fn(async () => true)
  const service = new WorkspaceRecovery(db, coordinator, teardown)
  expect(await service.attempt('two', root, lease.writer.id)).toBe('not_found')
  expect(await service.attempt('one', root, lease.writer.id)).toBe('active')
  lease.finish(false)
  db.raw.run("UPDATE workspace_writers SET recovery_mode='restored' WHERE id=?", [lease.writer.id])
  expect(await service.attempt('one', root, lease.writer.id)).toBe('restored')
  db.raw.run("UPDATE workspace_writers SET recovery_mode='owned' WHERE id=?", [lease.writer.id])
  db.raw.run(
    "INSERT INTO workspace_resources(id,writer_id,kind,identity_json) VALUES(?,?,'worker',?)",
    ['host', lease.writer.id, JSON.stringify({ hostCommands: true })],
  )
  expect(await service.attempt('one', root, lease.writer.id)).toBe('blocked')
  expect(teardown).not.toHaveBeenCalled()
})

test('serialized owner teardown stays blocking; successful known selection permits next writer', async () => {
  const lease = coordinator.claim('one', root, 'agent')
  lease.attach({ id: 'fixture-record', kind: 'container' })
  db.raw.run(
    "INSERT INTO workspace_resources(id,writer_id,kind,identity_json) VALUES(?,?,'container',?)",
    ['fixture-record', lease.writer.id, '{}'],
  )
  lease.finish(false)
  let release!: () => void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  const service = new WorkspaceRecovery(db, coordinator, async () => {
    await waiting
    db.raw.run('UPDATE workspace_resources SET cleanup_confirmed = 1 WHERE id = ?', [
      'fixture-record',
    ])
    return true
  })
  const recovery = service.attempt('one', root, lease.writer.id)
  expect(await service.attempt('two', root, lease.writer.id)).toBe('not_found')
  expect(await service.attempt('one', root, lease.writer.id)).toBe('active')
  expect(() => coordinator.claim('one', root, 'agent')).toThrow('workspace_recovery_required')
  release()
  expect(await recovery).toBe('recovered')
  expect(await service.attempt('one', root, lease.writer.id)).toBe('not_found')
  coordinator.claim('one', root, 'agent').finish(true)
})

test('missing or unlisted resource records cannot grant management cleanup', async () => {
  const lease = coordinator.claim('one', root, 'agent')
  lease.finish(false)
  const teardown = vi.fn(async () => true)
  const service = new WorkspaceRecovery(db, coordinator, teardown)
  expect(await service.attempt('one', root, lease.writer.id)).toBe('blocked')
  db.raw.run(
    "INSERT INTO workspace_resources(id,writer_id,kind,identity_json) VALUES(?,?,'container',?)",
    ['unlisted', lease.writer.id, '{}'],
  )
  expect(await service.attempt('one', root, lease.writer.id)).toBe('blocked')
  expect(teardown).not.toHaveBeenCalled()
  expect(() => coordinator.claim('one', root, 'agent')).toThrow('workspace_recovery_required')
})

test('current Team registration changes across teardown refuse the captured selection', async () => {
  const lease = coordinator.claim('one', root, 'agent')
  lease.attach({ id: 'registered-record', kind: 'container' })
  db.raw.run(
    "INSERT INTO workspace_resources(id,writer_id,kind,identity_json) VALUES(?,?,'container',?)",
    ['registered-record', lease.writer.id, '{}'],
  )
  lease.finish(false)
  let currentRoot: string | undefined = root
  const service = new WorkspaceRecovery(db, coordinator, async () => {
    currentRoot = undefined
    return true
  })
  expect(await service.attempt('one', root, lease.writer.id, () => currentRoot)).toBe(
    'selection_changed',
  )
  expect(() => coordinator.claim('one', root, 'agent')).toThrow('workspace_recovery_required')
})

test('same-timestamp Team recreation cannot acknowledge the deleted writer selection', async () => {
  const lease = coordinator.claim('one', root, 'agent')
  lease.attach({ id: 'old-incarnation-resource', kind: 'container' })
  db.raw.run(
    "INSERT INTO workspace_resources(id,writer_id,kind,identity_json) VALUES(?,?,'container',?)",
    ['old-incarnation-resource', lease.writer.id, '{}'],
  )
  lease.finish(false)
  const service = new WorkspaceRecovery(db, coordinator, async () => {
    db.raw.run('DELETE FROM teams WHERE id = ?', ['one'])
    db.raw.run('INSERT INTO teams(id,name,created_at) VALUES(?,?,?)', ['one', 'one', 1])
    return true
  })
  expect(await service.attempt('one', root, lease.writer.id, () => root)).toBe('selection_changed')
  // Writer records intentionally survive Team deletion; never infer their cleanup from it.
  expect(() => coordinator.claim('one', root, 'agent')).toThrow('workspace_recovery_required')
})

test('foreign connection metadata writes refuse acknowledgement without altering the schema', async () => {
  const file = join(root, 'isolated.sqlite')
  const primary = openDb(file)
  runMigrations(primary)
  primary.raw.run('INSERT INTO teams(id,name,created_at) VALUES(?,?,?)', ['one', 'one', 1])
  const other = openDb(file)
  try {
    const coordinator = new WorkspaceCoordinator(primary)
    const lease = coordinator.claim('one', root, 'agent')
    lease.attach({ id: 'foreign-write-record', kind: 'container' })
    primary.raw.run(
      "INSERT INTO workspace_resources(id,writer_id,kind,identity_json) VALUES(?,?,'container',?)",
      ['foreign-write-record', lease.writer.id, '{}'],
    )
    lease.finish(false)
    const service = new WorkspaceRecovery(primary, coordinator, async () => {
      other.raw.run('UPDATE teams SET name = ? WHERE id = ?', ['changed', 'one'])
      return true
    })
    expect(await service.attempt('one', root, lease.writer.id)).toBe('selection_changed')
    expect(() => coordinator.claim('one', root, 'agent')).toThrow('workspace_recovery_required')
  } finally {
    other.close()
    primary.close()
  }
})

test('confirmed cleanup plus unrelated DB mutation stays blocked, then stable retry does not replay cleanup', async () => {
  const lease = coordinator.claim('one', root, 'agent')
  lease.attach({ id: 'retry-record', kind: 'container' })
  db.raw.run(
    "INSERT INTO workspace_resources(id,writer_id,kind,identity_json) VALUES(?,?,'container',?)",
    ['retry-record', lease.writer.id, '{}'],
  )
  lease.finish(false)
  let executed = 0
  const service = new WorkspaceRecovery(db, coordinator, async () => {
    const record = db.raw
      .query<{ cleanup_confirmed: number }, []>('SELECT cleanup_confirmed FROM workspace_resources')
      .get()
    if (record?.cleanup_confirmed === 0) {
      executed++
      db.raw.run('UPDATE workspace_resources SET cleanup_confirmed = 1 WHERE id = ?', [
        'retry-record',
      ])
      db.raw.run('UPDATE teams SET name = ? WHERE id = ?', ['changed', 'one'])
    }
    return true
  })
  expect(await service.attempt('one', root, lease.writer.id)).toBe('selection_changed')
  expect(await service.attempt('one', root, lease.writer.id)).toBe('recovered')
  expect(executed).toBe(1)
})

test('management explains host and unconfirmed worker blockers without invoking teardown', async () => {
  const lease = coordinator.claim('one', root, 'agent')
  lease.attach({ id: 'worker', kind: 'worker' })
  db.raw.run(
    "INSERT INTO workspace_resources(id,writer_id,kind,identity_json) VALUES(?,?,'worker',?)",
    ['worker', lease.writer.id, JSON.stringify({ phase: 'supervised', hostCommands: false })],
  )
  lease.finish(false)
  const teardown = vi.fn(async () => true)
  const service = new WorkspaceRecovery(db, coordinator, teardown)
  expect(service.report('one', root).writers[0]).toEqual({
    writerId: lease.writer.id,
    posture: 'recovery_required',
    blocker: 'worker_cleanup_unconfirmed',
  })
  expect(await service.attempt('one', root, lease.writer.id)).toBe('blocked')
  db.raw.run('UPDATE workspace_resources SET identity_json = ? WHERE id = ?', [
    JSON.stringify({ hostCommands: true }),
    'worker',
  ])
  expect(service.report('one', root).writers[0]?.blocker).toBe('host_commands')
  expect(await service.attempt('one', root, lease.writer.id)).toBe('blocked')
  db.raw.run('UPDATE workspace_resources SET identity_json = ? WHERE id = ?', ['null', 'worker'])
  expect(service.report('one', root).writers[0]?.blocker).toBe('resource_records_unavailable')
  expect(await service.attempt('one', root, lease.writer.id)).toBe('blocked')
  expect(teardown).not.toHaveBeenCalled()
  expect(() => coordinator.claim('one', root, 'agent')).toThrow('workspace_recovery_required')
})

test('previously confirmed host-worker records settle without new process signalling', async () => {
  // A modeled prior confirmation, not a proof that arbitrary host commands have stopped.
  const lifecycle = workspaceLifecycle(db)
  const lease = lifecycle.coordinator.claim('one', root, 'agent')
  lease.attach({ id: 'confirmed-host-record', kind: 'worker' })
  db.raw.run(
    "INSERT INTO workspace_resources(id,writer_id,kind,identity_json,cleanup_confirmed) VALUES(?,?,'worker',?,1)",
    ['confirmed-host-record', lease.writer.id, JSON.stringify({ hostCommands: true })],
  )
  lease.finish(false)
  const signal = vi.spyOn(process, 'kill')
  try {
    expect(await lifecycle.managementRecovery.attempt('one', root, lease.writer.id)).toBe(
      'recovered',
    )
    expect(signal).not.toHaveBeenCalled()
  } finally {
    signal.mockRestore()
  }
})

test('management cleanup refuses a substituted record even when the replacement claims confirmation', async () => {
  const lifecycle = workspaceLifecycle(db)
  const lease = lifecycle.coordinator.claim('one', root, 'agent')
  lease.attach({ id: 'selected-record', kind: 'container' })
  db.raw.run(
    "INSERT INTO workspace_resources(id,writer_id,kind,identity_json) VALUES(?,?,'container','{}')",
    ['selected-record', lease.writer.id],
  )
  const record = {
    id: 'selected-record',
    writer_id: lease.writer.id,
    kind: 'container' as const,
    identity_json: '{}',
    creation_acknowledged: 0,
  }
  lease.finish(false)
  db.raw.run(
    'UPDATE workspace_resources SET identity_json = ?, cleanup_confirmed = 1 WHERE id = ?',
    ['{"changed":true}', 'selected-record'],
  )
  expect(
    await lifecycle.resources.cleanupResource('selected-record', false, {
      confirmedWorkersOnly: true,
      record,
    }),
  ).toBe(false)
  expect(() => lifecycle.coordinator.claim('one', root, 'agent')).toThrow(
    'workspace_recovery_required',
  )
})

test.each([
  'identity',
  'acknowledgement',
  'restored',
] as const)('resource %s drift during cleanup cannot grant a confirmation', async (drift) => {
  // Modeled executor result tests the DB effect boundary, not actual Docker qualification.
  const lifecycle = workspaceLifecycle(db)
  const lease = lifecycle.coordinator.claim('one', root, 'agent')
  lease.attach({ id: 'pending-resource', kind: 'container' })
  db.raw.run(
    "INSERT INTO workspace_resources(id,writer_id,kind,identity_json) VALUES(?,?,'container','{}')",
    ['pending-resource', lease.writer.id],
  )
  let release!: () => void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  const executor = vi.spyOn(docker, 'terminateRecordedContainer').mockImplementation(async () => {
    await waiting
    return true
  })
  try {
    const pending = lifecycle.resources.cleanupResource('pending-resource')
    expect(executor).toHaveBeenCalledTimes(1)
    if (drift === 'identity')
      db.raw.run('UPDATE workspace_resources SET identity_json = \'{"changed":true}\'')
    else if (drift === 'acknowledgement')
      db.raw.run('UPDATE workspace_resources SET creation_acknowledged = 1')
    else db.raw.run("UPDATE workspace_writers SET recovery_mode = 'restored'")
    release()
    expect(await pending).toBe(false)
    expect(
      db.raw
        .query<{ cleanup_confirmed: number }, []>(
          'SELECT cleanup_confirmed FROM workspace_resources',
        )
        .get()?.cleanup_confirmed,
    ).toBe(0)
  } finally {
    executor.mockRestore()
  }
})

test('reentrant teardown cannot start a second management cleanup', async () => {
  const lease = coordinator.claim('one', root, 'agent')
  lease.attach({ id: 'reentrant-record', kind: 'container' })
  db.raw.run(
    "INSERT INTO workspace_resources(id,writer_id,kind,identity_json) VALUES(?,?,'container','{}')",
    ['reentrant-record', lease.writer.id],
  )
  lease.finish(false)
  const teardown = vi.fn(async () => {
    expect(await service.attempt('one', root, lease.writer.id)).toBe('active')
    db.raw.run('UPDATE workspace_resources SET cleanup_confirmed = 1 WHERE id = ?', [
      'reentrant-record',
    ])
    return true
  })
  const service = new WorkspaceRecovery(db, coordinator, teardown)
  expect(await service.attempt('one', root, lease.writer.id)).toBe('recovered')
  expect(teardown).toHaveBeenCalledTimes(1)
})

test('a teardown boolean without recorded cleanup confirmation cannot release a writer', async () => {
  const lease = coordinator.claim('one', root, 'agent')
  lease.attach({ id: 'unconfirmed-container', kind: 'container' })
  db.raw.run(
    "INSERT INTO workspace_resources(id,writer_id,kind,identity_json) VALUES(?,?,'container','{}')",
    ['unconfirmed-container', lease.writer.id],
  )
  lease.finish(false)
  const service = new WorkspaceRecovery(db, coordinator, async () => true)
  expect(await service.attempt('one', root, lease.writer.id)).toBe('blocked')
  expect(() => coordinator.claim('one', root, 'agent')).toThrow('workspace_recovery_required')
})

test.skipIf(process.platform !== 'linux' && process.platform !== 'darwin')(
  'recorded real child cleanup permits management recovery and a new writer on the same root',
  async () => {
    // Actual process/output capture and cleanup; the child is a controlled helper, not a
    // full Agent/provider/container acceptance or proof about arbitrary host commands.
    const lifecycle = workspaceLifecycle(db)
    const lease = lifecycle.coordinator.claim('one', root, 'agent')
    const worker = lifecycle.worker(lease)
    worker.beforeSpawn?.()
    const child = spawn(
      process.execPath,
      [
        '-e',
        "console.log('ready');process.stdin.once('end',()=>process.exit(1));process.stdin.resume()",
      ],
      { detached: true, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    child.stderr.resume()
    try {
      await once(child.stdout, 'data')
      if (!child.pid) throw new Error('Missing helper child')
      worker.beforeInput(child.pid, false, child)
      lease.finish(false)
      const resource = db.raw
        .query<{ id: string }, [string]>(
          "SELECT id FROM workspace_resources WHERE writer_id = ? AND kind = 'worker'",
        )
        .get(lease.writer.id)
      if (!resource) throw new Error('Missing recorded helper')
      expect(
        await lifecycle.resources.cleanupResource(resource.id, false, {
          confirmedWorkersOnly: true,
        }),
      ).toBe(false)
      expect(child.signalCode).toBeNull()
      const service = lifecycle.managementRecovery
      expect(await service.attempt('one', root, lease.writer.id)).toBe('blocked')
      expect(child.exitCode).toBeNull()
      const exited = once(child, 'exit')
      child.stdin.end()
      await exited
      expect(child.exitCode).toBe(1)
      expect(await worker.afterExit(false)).toBe(true)
      expect(service.report('one', root).writers).toEqual([
        { writerId: lease.writer.id, posture: 'recovery_required' },
      ])
      expect(() => lifecycle.coordinator.claim('one', root, 'agent')).toThrow(
        'workspace_recovery_required',
      )
      expect(await service.attempt('one', root, lease.writer.id)).toBe('recovered')
      expect(await service.attempt('one', root, lease.writer.id)).toBe('not_found')
      expect(service.report('one', root).writers).toEqual([])
      lifecycle.coordinator.claim('one', root, 'agent').finish(true)
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit')
        child.kill('SIGKILL')
        await exited
      }
      child.stdout.destroy()
      child.stderr.destroy()
    }
  },
)

test.each([
  'confirmation',
  'identity',
  'registration',
] as const)('final release refuses nested-microtask %s drift', async (drift) => {
  // Modeled records isolate the final-release race; no actual container is executed.
  const lease = coordinator.claim('one', root, 'agent')
  lease.attach({ id: 'final-release-record', kind: 'container' })
  db.raw.run(
    "INSERT INTO workspace_resources(id,writer_id,kind,identity_json) VALUES(?,?,'container','{}')",
    ['final-release-record', lease.writer.id],
  )
  lease.finish(false)
  let currentRoot: string | undefined = root
  let mutated = false
  const service = new WorkspaceRecovery(db, coordinator, async () => {
    db.raw.run('UPDATE workspace_resources SET cleanup_confirmed = 1 WHERE id = ?', [
      'final-release-record',
    ])
    queueMicrotask(() =>
      queueMicrotask(() => {
        mutated = true
        if (drift === 'confirmation')
          db.raw.run('UPDATE workspace_resources SET cleanup_confirmed = 0 WHERE id = ?', [
            'final-release-record',
          ])
        else if (drift === 'identity')
          db.raw.run('UPDATE workspace_resources SET identity_json = ? WHERE id = ?', [
            '{"changed":true}',
            'final-release-record',
          ])
        else currentRoot = undefined
      }),
    )
    return true
  })
  expect(await service.attempt('one', root, lease.writer.id, () => currentRoot)).toBe(
    'selection_changed',
  )
  expect(mutated).toBe(true)
  expect(
    db.raw
      .query<{ id: string }, [string]>('SELECT id FROM workspace_writers WHERE id = ?')
      .get(lease.writer.id)?.id,
  ).toBe(lease.writer.id)
  expect(
    db.raw
      .query<{ id: string }, [string]>('SELECT id FROM workspace_resources WHERE id = ?')
      .get('final-release-record')?.id,
  ).toBe('final-release-record')
  expect(() => coordinator.claim('one', root, 'agent')).toThrow('workspace_recovery_required')
})

test('resource identity changes during teardown cannot acknowledge the selected writer', async () => {
  const lease = coordinator.claim('one', root, 'agent')
  lease.attach({ id: 'resource', kind: 'container' })
  lease.finish(false)
  db.raw.run(
    "INSERT INTO workspace_resources(id,writer_id,kind,identity_json) VALUES(?,?,'container',?)",
    ['resource', lease.writer.id, '{}'],
  )
  const service = new WorkspaceRecovery(db, coordinator, async () => {
    db.raw.run('UPDATE workspace_resources SET identity_json=? WHERE id=?', [
      '{"changed":true}',
      'resource',
    ])
    return true
  })
  expect(await service.attempt('one', root, lease.writer.id)).toBe('selection_changed')
  expect(() => coordinator.claim('one', root, 'agent')).toThrow('workspace_recovery_required')
})
