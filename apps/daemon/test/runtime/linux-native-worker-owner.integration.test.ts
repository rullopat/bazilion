import { ChildProcess, execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, vi } from 'vitest'
import { workspaceLifecycle } from '../../src/lib/coding-environment/lifecycle.ts'
import { WorkspaceResources } from '../../src/lib/coding-environment/resources.ts'
import { OwnedLinuxNativeWorker } from '../../src/lib/process/linux-worker.ts'
import {
  captureWorkerProcess,
  observeWorkerOutputRelease,
} from '../../src/runtime/worker/process-identity.ts'
import { makeTestEnv } from '../core/helpers.ts'

const enabled = process.platform === 'linux' && process.env.BAZILION_TEST_NATIVE === '1'
function controlled(extra = '') {
  const child = spawn(
    process.execPath,
    [
      '-e',
      `process.stdin.resume();process.stdin.once('end',()=>process.exit(0));${extra};process.stdout.write('ready\\n')`,
    ],
    { detached: true, stdio: ['pipe', 'pipe', 'pipe'] },
  )
  const closed = once(child, 'close')
  const ready = new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.stdout.once('data', () => resolve())
  })
  return { child, closed, ready }
}

test.skipIf(!enabled)(
  'live native worker settles alongside an independently owned inaccessible sibling; cold receipts never acquire authority',
  async () => {
    const env = makeTestEnv(),
      services = workspaceLifecycle(env.db),
      lease = await services.claim(env.teamId, env.paths.teamDir(env.teamId), 'agent')
    const worker = services.nativeWorker(lease),
      owned = controlled(),
      root = mkdtempSync(join(tmpdir(), 'native-worker-sibling-'))
    let sibling: ChildProcess | undefined, siblingClosed: Promise<unknown[]> | undefined
    let confirmed = false
    try {
      worker.beforeSpawn?.()
      await owned.ready
      if (!owned.child.pid) throw new Error('owned child missing')
      worker.beforeInput(owned.child.pid, false, owned.child)
      const legacy = { ...captureWorkerProcess(owned.child.pid), hostCommands: false }
      const row = env.db.raw
        .query<{ id: string; identity_json: string }, []>(
          'SELECT id,identity_json FROM workspace_resources',
        )
        .get()
      expect(row).toBeTruthy()
      if (!row) throw new Error('missing registration')
      expect(JSON.parse(row.identity_json).kind).toBe('owned-linux-native-child')
      expect(await new WorkspaceResources(env.db).cleanupResource(row.id, true)).toBe(false)
      expect(owned.child.exitCode).toBe(null)
      const executable = join(root, 'sibling')
      execFileSync('cc', [
        '-Wall',
        '-Werror',
        fileURLToPath(new URL('../fixtures/worker-fd-visibility.c', import.meta.url)),
        '-o',
        executable,
      ])
      const foreign = spawn(executable, [], { detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
      sibling = foreign
      siblingClosed = once(foreign, 'close')
      await new Promise<void>((resolve, reject) => {
        foreign.once('error', reject)
        foreign.stdout.once('data', () => resolve())
      })
      expect(() => readdirSync(`/proc/${foreign.pid}/fd`)).toThrow(
        expect.objectContaining({ code: 'EACCES' }),
      )
      owned.child.stdin.end()
      owned.child.stdout.resume()
      owned.child.stderr.resume()
      expect(await owned.closed).toEqual([0, null])
      expect(observeWorkerOutputRelease(legacy)).toBe(false)
      // Both callers share one original-owner retirement; neither consults or signals the sibling.
      expect(await Promise.all([worker.afterExit(true), worker.afterExit(true)])).toEqual([
        true,
        true,
      ])
      expect(foreign.exitCode).toBe(null)
      await services.release(lease)
      expect(env.db.raw.query('SELECT id FROM workspace_writers').all()).toEqual([])
      confirmed = true
    } finally {
      owned.child.stdin.end()
      owned.child.stdout.resume()
      owned.child.stderr.resume()
      await owned.closed
      if (sibling) {
        sibling.stdin?.end()
        sibling.stdout?.resume()
        sibling.stderr?.resume()
        await siblingClosed
      }
      rmSync(root, { recursive: true })
      if (confirmed) env.cleanup()
      else {
        env.db.close()
        console.error(`Native Linux worker ownership fixture retained: ${env.home}`)
      }
    }
  },
  15_000,
)

test.skipIf(!enabled)(
  'native worker TERM/KILL use its original pidfd, never ChildProcess.kill or receipt/group signalling',
  async () => {
    const env = makeTestEnv(),
      services = workspaceLifecycle(env.db),
      lease = await services.claim(env.teamId, env.paths.teamDir(env.teamId), 'agent')
    const worker = services.nativeWorker(lease),
      owned = controlled("process.on('SIGTERM',()=>process.stdout.write('term\\n'))")
    let confirmed = false
    try {
      worker.beforeSpawn?.()
      await owned.ready
      if (!owned.child.pid || !worker.signal) throw new Error('original child/sender missing')
      worker.beforeInput(owned.child.pid, false, owned.child)
      const kill = vi.spyOn(owned.child, 'kill')
      const term = once(owned.child.stdout, 'data')
      worker.beforeSignal?.()
      worker.signal('SIGTERM')
      expect(String((await term)[0])).toContain('term')
      expect(owned.child.exitCode).toBe(null)
      worker.beforeSignal?.()
      worker.signal('SIGKILL')
      owned.child.stdout.resume()
      owned.child.stderr.resume()
      expect(await owned.closed).toEqual([null, 'SIGKILL'])
      expect(kill).not.toHaveBeenCalled()
      kill.mockRestore()
      expect(await worker.afterExit(false)).toBe(true)
      await services.release(lease)
      expect(env.db.raw.query('SELECT id FROM workspace_writers').all()).toEqual([])
      confirmed = true
    } finally {
      owned.child.stdin.end()
      owned.child.stdout.resume()
      owned.child.stderr.resume()
      await owned.closed
      if (confirmed) env.cleanup()
      else {
        env.db.close()
        console.error(`Native Linux worker signal fixture retained: ${env.home}`)
      }
    }
  },
  10_000,
)

test.skipIf(!enabled)(
  'a live native worker cannot settle from group absence before its actual inherited output endpoint reaches EOF',
  async () => {
    const env = makeTestEnv(),
      services = workspaceLifecycle(env.db),
      lease = await services.claim(env.teamId, env.paths.teamDir(env.teamId), 'agent')
    const worker = services.nativeWorker(lease)
    const child = spawn(
      process.execPath,
      [
        '-e',
        `const{spawn}=require('node:child_process');process.stdin.resume();process.stdin.once('end',()=>{spawn(process.execPath,['-e',"setTimeout(()=>process.stdout.write('descendant-finished\\\\n'),500)"],{detached:true,stdio:['ignore',process.stdout,process.stderr]}).unref();process.exit(0)});process.stdout.write('ready\\n')`,
      ],
      { detached: true, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    const closed = once(child, 'close'),
      exited = once(child, 'exit')
    let stdout = '',
      stderr = ''
    child.stdout.on('data', (bytes) => {
      stdout += bytes.toString()
    })
    child.stderr.on('data', (bytes) => {
      stderr += bytes.toString()
    })
    let confirmed = false
    try {
      worker.beforeSpawn?.()
      await new Promise<void>((resolve, reject) => {
        child.once('error', reject)
        child.stdout.once('data', () => resolve())
      })
      if (!child.pid) throw new Error('missing child')
      worker.beforeInput(child.pid, false, child)
      child.stdin.end()
      child.stdout.resume()
      child.stderr.resume()
      await exited
      expect(child.stdout.readableEnded).toBe(false)
      let settled = false
      const pending = worker.afterExit(true).then((value) => {
        settled = value
        return value
      })
      await new Promise((resolve) => setImmediate(resolve))
      expect(settled).toBe(false)
      expect(
        env.db.raw.query('SELECT id FROM workspace_resources WHERE cleanup_confirmed=0').all(),
      ).toHaveLength(1)
      await closed
      expect(stdout).toContain('descendant-finished')
      expect(stderr).toBe('')
      expect(await pending).toBe(true)
      await services.release(lease)
      confirmed = true
    } finally {
      child.stdin.end()
      child.stdout.resume()
      child.stderr.resume()
      await closed
      if (confirmed) env.cleanup()
      else {
        env.db.close()
        console.error(`Native Linux worker EOF fixture retained: ${env.home}`)
      }
    }
  },
  10_000,
)

test.skipIf(!enabled).each(['identity', 'restored'] as const)(
  '%s substitution revokes native worker authority permanently and cannot fall through to legacy PID recovery',
  async (kind) => {
    const env = makeTestEnv(),
      services = workspaceLifecycle(env.db),
      lease = await services.claim(env.teamId, env.paths.teamDir(env.teamId), 'agent')
    const worker = services.nativeWorker(lease),
      owned = controlled()
    try {
      worker.beforeSpawn?.()
      await owned.ready
      if (!owned.child.pid || !worker.signal) throw new Error('missing original authority')
      worker.beforeInput(owned.child.pid, false, owned.child)
      const row = env.db.raw
        .query<{ id: string; identity_json: string }, []>(
          'SELECT id,identity_json FROM workspace_resources',
        )
        .get()
      if (!row) throw new Error('missing worker resource')
      if (kind === 'identity')
        env.db.raw.run('UPDATE workspace_resources SET identity_json=? WHERE id=?', [
          JSON.stringify({ ...captureWorkerProcess(owned.child.pid), hostCommands: false }),
          row.id,
        ])
      else
        env.db.raw.run("UPDATE workspace_writers SET recovery_mode='restored' WHERE id=?", [
          lease.writer.id,
        ])
      expect(() => worker.signal?.('SIGTERM')).toThrow('registration changed')
      expect(owned.child.exitCode).toBe(null)
      env.db.raw.run('UPDATE workspace_resources SET identity_json=? WHERE id=?', [
        row.identity_json,
        row.id,
      ])
      env.db.raw.run("UPDATE workspace_writers SET recovery_mode='owned' WHERE id=?", [
        lease.writer.id,
      ])
      expect(() => worker.signal?.('SIGKILL')).toThrow('ownership unavailable')
      expect(await worker.afterExit(true)).toBe(false)
      owned.child.stdin.end()
      owned.child.stdout.resume()
      owned.child.stderr.resume()
      await owned.closed
      expect(await worker.afterExit(true)).toBe(false)
      await services.release(lease)
      expect(
        env.db.raw.query("SELECT id FROM workspace_writers WHERE state='recovery'").all(),
      ).toHaveLength(1)
    } finally {
      owned.child.stdin.end()
      owned.child.stdout.resume()
      owned.child.stderr.resume()
      await owned.closed
      env.db.close()
      console.error(
        `Expected revoked native Linux worker fixture retained (never force released): ${env.home}`,
      )
    }
  },
  10_000,
)

test.skipIf(!enabled)(
  'local transport destruction is not native worker EOF or a cleanup confirmation',
  async () => {
    const env = makeTestEnv(),
      services = workspaceLifecycle(env.db),
      lease = await services.claim(env.teamId, env.paths.teamDir(env.teamId), 'agent')
    const worker = services.nativeWorker(lease),
      owned = controlled()
    try {
      worker.beforeSpawn?.()
      await owned.ready
      if (!owned.child.pid) throw new Error('owned child missing')
      worker.beforeInput(owned.child.pid, false, owned.child)
      owned.child.stdout.destroy()
      owned.child.stdin.end()
      owned.child.stderr.resume()
      await owned.closed
      expect(owned.child.stdout.readableEnded).toBe(false)
      expect(await worker.afterExit(true)).toBe(false)
      await services.release(lease)
      expect(
        env.db.raw.query("SELECT id FROM workspace_writers WHERE state='recovery'").all(),
      ).toHaveLength(1)
    } finally {
      owned.child.stdin.end()
      owned.child.stderr.resume()
      await owned.closed
      env.db.close()
      console.error(
        `Expected locally destroyed native worker fixture retained (never force released): ${env.home}`,
      )
    }
  },
  10_000,
)

test.skipIf(!enabled)(
  'native worker admission rejects fabricated children and host-command widening',
  async () => {
    const owned = controlled()
    try {
      await owned.ready
      if (!owned.child.pid) throw new Error('missing child')
      const pid = owned.child.pid
      expect(() => new OwnedLinuxNativeWorker(pid, new ChildProcess(), false)).toThrow(
        'ownership unavailable',
      )
      expect(() => new OwnedLinuxNativeWorker(pid, owned.child, true)).toThrow(
        'ownership unavailable',
      )
    } finally {
      owned.child.stdin.end()
      owned.child.stdout.resume()
      owned.child.stderr.resume()
      await owned.closed
    }
  },
  10_000,
)
