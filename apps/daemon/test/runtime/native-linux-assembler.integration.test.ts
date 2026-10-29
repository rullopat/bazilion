import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { setTimeout as wait } from 'node:timers/promises'
import { expect, test } from 'vitest'
import { openDb } from '../../src/core/db/client.ts'
import { runMigrations } from '../../src/core/db/migrate.ts'
import { workspaceLifecycle } from '../../src/lib/coding-environment/lifecycle.ts'
import {
  type NativeLinuxView,
  prepareNativeLinuxView,
} from '../../src/lib/native-execution/linux-view.ts'
import { prepareNativeRuntime } from '../../src/lib/native-execution/runtime.ts'
import { OwnedLinuxNamespace } from '../../src/lib/process/linux-domain.ts'

const enabled = process.platform === 'linux' && process.env.BAZILION_TEST_NATIVE === '1'
test.skipIf(!enabled)(
  'assembled sparse native view runs pinned Node and keeps memory/outside/IP unavailable',
  async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-linux-assembled-')))
    const workspace = join(root, 'workspace'),
      job = join(root, 'job'),
      outside = join(root, 'outside')
    mkdirSync(workspace)
    mkdirSync(join(workspace, 'memory'))
    mkdirSync(job, { mode: 0o700 })
    writeFileSync(join(workspace, 'memory', 'note'), 'readonly')
    writeFileSync(outside, 'private-outside-canary')
    const db = openDb(join(root, 'state.sqlite'))
    runMigrations(db)
    db.raw.run('INSERT INTO teams(id,name,created_at) VALUES(?,?,?)', ['one', 'one', 1])
    const lifecycle = workspaceLifecycle(db)
    const lease = lifecycle.coordinator.claim('one', workspace, 'agent')
    const runtimeRoot = join(root, 'runtime')
    mkdirSync(runtimeRoot, { mode: 0o700 })
    const runtime = await prepareNativeRuntime(runtimeRoot)
    let binding: ReturnType<typeof lifecycle.native> | undefined
    let view: NativeLinuxView | undefined,
      owner: OwnedLinuxNamespace | undefined,
      attempted = false
    try {
      view = await prepareNativeLinuxView(
        {
          root: job,
          workspace,
          cwd: '.',
          env: { CI: 'true' },
          readOnlyDirectories: [],
          readOnlyFiles: [],
          unavailable: [{ path: outside, kind: 'file' }],
        },
        runtime,
      )
      await view.revalidate()
      binding = lifecycle.native(lease, view.backend, view.definition, view)
      const prepared = view
      expect(() =>
        lifecycle.native(lease, prepared.backend, prepared.definition, prepared),
      ).toThrow('definition')
      const nonce = randomUUID()
      const arguments_ = view.arguments(nonce)
      expect(() => view?.arguments(randomUUID())).toThrow('refused')
      expect(arguments_.join(' ')).not.toContain('private-outside-canary')
      binding.beforeSpawn()
      attempted = true
      const child = spawn(view.manager.requestedPath, arguments_, {
        cwd: job,
        env: { ...view.env },
        detached: true,
        stdio: [...view.stdio],
      })
      let stdout = '',
        stderr = ''
      if (!child.stdout || !child.stderr) throw new Error('Native command output pipes unavailable')
      child.stdout.on('data', (bytes) => {
        stdout += bytes.toString()
      })
      child.stderr.on('data', (bytes) => {
        stderr += bytes.toString()
      })
      owner = new OwnedLinuxNamespace(child, nonce)
      binding.bind(owner)
      const channels: readonly unknown[] = child.stdio
      const gate = channels[5]
      if (!(gate instanceof Writable)) throw new Error('Native startup gate unavailable')
      gate.end()
      await binding.afterCreation()
      await view.revalidate()
      const script = `node --input-type=module - <<'JS'
import fs from 'node:fs'
import net from 'node:net'
import {spawnSync} from 'node:child_process'
const errors={}
try { fs.writeFileSync(${JSON.stringify(join(workspace, 'memory', 'note'))},'forbidden') } catch(error) { errors.memory=error.code }
try { fs.readFileSync(${JSON.stringify(outside)}) } catch(error) { errors.outside=error.code }
await new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port:9});socket.once('error',error=>{errors.ip=error.code;resolve()});socket.once('connect',()=>{errors.ip='connected';socket.destroy();resolve()})})
errors.unadmittedProgram=spawnSync('/usr/bin/id').error?.code
fs.writeFileSync('result',JSON.stringify({errors,execPath:process.execPath,status:fs.readFileSync('/proc/self/status','utf8')}))
console.log('native-assembled')
JS
`
      await owner.execute(script)
      const deadline = performance.now() + 3000
      while (!owner.isSettled() && performance.now() < deadline) await wait(10)
      expect(owner.isSettled(), stderr).toBe(true)
      expect(stdout).toContain('native-assembled')
      const result = JSON.parse(readFileSync(join(workspace, 'result'), 'utf8'))
      expect(result.errors).toEqual({
        memory: 'EROFS',
        outside: 'ENOENT',
        ip: 'EPERM',
        unadmittedProgram: 'ENOENT',
      })
      expect(result.execPath).toBe(realpathSync(process.execPath))
      expect(result.status).toMatch(/^NoNewPrivs:\s+1$/m)
      expect(result.status).toMatch(/^Seccomp:\s+2$/m)
      expect(result.status).toMatch(/^CapBnd:\s+0000000000000000$/m)
      expect(readFileSync(join(workspace, 'memory', 'note'), 'utf8')).toBe('readonly')
      expect(readFileSync(outside, 'utf8')).toBe('private-outside-canary')
      expect(await binding.afterExit()).toBe(true)
      await expect(view.revalidate()).rejects.toThrow('refused')
      await lifecycle.release(lease)
      expect(db.raw.query('SELECT id FROM workspace_writers').all()).toEqual([])
      expect(runtime.close()).toBe(true)
      db.close()
      rmSync(root, { recursive: true })
    } catch (cause) {
      if (binding) {
        if (attempted) await binding.afterExit()
        else binding.cancelBeforeSpawn()
      } else if (!attempted) view?.close()
      throw new Error(`Assembled native view failed; retained ${root}`, { cause })
    }
  },
  20_000,
)
