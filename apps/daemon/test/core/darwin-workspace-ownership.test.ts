import { type ChildProcess, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test, vi } from 'vitest'
import { openDb } from '../../src/core/db/client.ts'
import { runMigrations } from '../../src/core/db/migrate.ts'
import { workspaceLifecycle } from '../../src/lib/coding-environment/lifecycle.ts'
import { getDarwinProcessInspector } from '../../src/lib/process/darwin.ts'

const mac = process.platform === 'darwin'
const fixtures: {
  root: string
  db: ReturnType<typeof openDb>
  child: ChildProcess
  closed: Promise<unknown>
}[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const f of fixtures.splice(0)) {
    if (f.child.exitCode === null && f.child.signalCode === null) f.child.kill('SIGKILL')
    await f.closed
    f.db.close()
    rmSync(f.root, { recursive: true, force: true })
  }
})
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'darwin-workspace-')))
  const path = join(root, 'state.sqlite')
  const db = openDb(path)
  runMigrations(db)
  for (const id of ['one', 'two'])
    db.raw.run('INSERT INTO teams(id,name,created_at) VALUES(?,?,?)', [id, id, 1])
  const lifecycle = workspaceLifecycle(db)
  const lease = lifecycle.coordinator.claim('one', root, 'agent')
  const worker = lifecycle.worker(lease)
  try {
    worker.beforeSpawn?.()
  } catch (error) {
    db.close()
    rmSync(root, { recursive: true, force: true })
    throw error
  }
  const entry = fileURLToPath(new URL('../fixtures/observed-worker.mjs', import.meta.url))
  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {},
  })
  const closed = once(child, 'close')
  child.stdout.resume()
  child.stderr.resume()
  const owned = { root, db, child, closed }
  fixtures.push(owned)
  if (!child.pid) throw new Error('Missing controlled child')
  worker.beforeInput(child.pid, false, child)
  const record = db.raw
    .query<{ id: string; identity_json: string }, []>(
      'SELECT id, identity_json FROM workspace_resources',
    )
    .get()
  if (!record) throw new Error('Missing recorded worker')
  return Object.assign(owned, { path, lifecycle, lease, worker, record })
}

test.skipIf(!mac)(
  'native cancellation keeps exclusion until recorded cleanup and supported acknowledgement',
  async () => {
    const f = fixture()
    f.lease.finish(false)
    expect(() => f.lifecycle.coordinator.claim('two', f.root, 'agent')).toThrow(
      'workspace_recovery_required',
    )
    f.worker.beforeSignal?.()
    f.child.kill('SIGTERM')
    await f.closed
    expect(await f.worker.afterExit(false)).toBe(true)
    expect(() => f.lifecycle.coordinator.claim('two', f.root, 'agent')).toThrow(
      'workspace_recovery_required',
    )
    const signal = vi.spyOn(process, 'kill')
    expect(await f.lifecycle.managementRecovery.attempt('one', f.root, f.lease.writer.id)).toBe(
      'recovered',
    )
    expect(signal).not.toHaveBeenCalled()
    f.lifecycle.coordinator.claim('two', f.root, 'agent').finish(true)
  },
)

test.skipIf(!mac)(
  'a reopened database never reconstructs native signalling authority from receipts',
  async () => {
    const f = fixture()
    f.lease.finish(false)
    f.db.close()
    f.db = openDb(f.path)
    const restarted = workspaceLifecycle(f.db)
    const signal = vi.spyOn(process, 'kill')
    restarted.resources.beforeWorkerSignal(f.record.id)
    expect(await restarted.resources.cleanupResource(f.record.id)).toBe(false)
    expect(await restarted.managementRecovery.attempt('one', f.root, f.lease.writer.id)).toBe(
      'blocked',
    )
    expect(signal).not.toHaveBeenCalled()
    expect(f.child.exitCode).toBeNull()
    expect(() => restarted.coordinator.claim('two', f.root, 'agent')).toThrow(
      'workspace_recovery_required',
    )
  },
)

test.skipIf(!mac)(
  'restored native receipts cannot signal or reuse a previous cleanup flag',
  async () => {
    const f = fixture()
    f.lease.finish(false)
    f.db.raw.run("UPDATE workspace_writers SET recovery_mode = 'restored'")
    f.db.raw.run('UPDATE workspace_resources SET cleanup_confirmed = 1')
    const signal = vi.spyOn(process, 'kill')
    f.lifecycle.resources.beforeWorkerSignal(f.record.id)
    expect(await f.lifecycle.resources.cleanupResource(f.record.id)).toBe(false)
    expect(await f.lifecycle.managementRecovery.attempt('one', f.root, f.lease.writer.id)).toBe(
      'restored',
    )
    expect(signal).not.toHaveBeenCalled()
    expect(f.child.exitCode).toBeNull()
  },
)

test.skipIf(!mac)(
  'a substituted native contract cannot borrow the current live child owner',
  async () => {
    const f = fixture()
    const identity = JSON.parse(f.record.identity_json)
    f.db.raw.run('UPDATE workspace_resources SET identity_json = ?', [
      JSON.stringify({ ...identity, hostCommands: true }),
    ])
    const signal = vi.spyOn(process, 'kill')
    f.worker.beforeSignal?.()
    expect(await f.worker.afterExit(true)).toBe(false)
    expect(signal).not.toHaveBeenCalled()
    expect(f.child.exitCode).toBeNull()
  },
)

test.skipIf(!mac)(
  'a delayed native confirmation cannot acknowledge substituted resource metadata',
  async () => {
    const f = fixture()
    f.child.stdin.end('fail\n')
    await f.closed
    const inspector = getDarwinProcessInspector()
    const group = inspector.group.bind(inspector)
    vi.spyOn(inspector, 'group').mockImplementation((pid) => {
      const result = group(pid)
      queueMicrotask(() => f.db.raw.run('UPDATE workspace_resources SET identity_json = ?', ['{}']))
      return result
    })
    expect(await f.worker.afterExit(true)).toBe(false)
    expect(
      f.db.raw
        .query<{ cleanup_confirmed: number }, []>(
          'SELECT cleanup_confirmed FROM workspace_resources',
        )
        .get()?.cleanup_confirmed,
    ).toBe(0)
  },
)
