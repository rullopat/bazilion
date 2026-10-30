import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import {
  captureWorkerProcess,
  observeWorkerOutputRelease,
} from '../../src/runtime/worker/process-identity.ts'

const enabled = process.platform === 'linux' && process.env.BAZILION_TEST_NATIVE === '1'
test.skipIf(!enabled)(
  'diagnostic control: a new independent non-dumpable sibling blocks the legacy global FD census despite normal worker EOF',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'worker-fd-census-'))
    const executable = join(root, 'foreign-child')
    execFileSync('cc', [
      '-Wall',
      '-Werror',
      fileURLToPath(new URL('../fixtures/worker-fd-visibility.c', import.meta.url)),
      '-o',
      executable,
    ])
    const worker = spawn(
      process.execPath,
      [
        '-e',
        "process.stdout.write('ready\\n');process.stdin.resume();process.stdin.once('end',()=>process.exit(0))",
      ],
      { detached: true, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    const workerClosed = once(worker, 'close')
    let foreign: ChildProcess | undefined, foreignClosed: Promise<unknown[]> | undefined
    try {
      // Keep the actual streams intact; local destruction must not manufacture worker EOF.
      await new Promise<void>((resolve, reject) => {
        worker.once('error', reject)
        worker.stdout.once('data', () => resolve())
      })
      if (!worker.pid) throw new Error('owned worker PID missing')
      const identity = { ...captureWorkerProcess(worker.pid), hostCommands: false }
      const sibling = spawn(executable, [], { detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
      foreign = sibling
      foreignClosed = once(sibling, 'close')
      await new Promise<void>((resolve, reject) => {
        sibling.once('error', reject)
        sibling.stdout.once('data', () => resolve())
      })
      if (!sibling.pid) throw new Error('independent owned sibling PID missing')
      const siblingPid = sibling.pid
      expect(() => readdirSync(`/proc/${siblingPid}/fd`)).toThrow(
        expect.objectContaining({ code: 'EACCES' }),
      )
      worker.stdin.end()
      worker.stdout.resume()
      worker.stderr.resume()
      expect(await workerClosed).toEqual([0, null])
      expect(worker.stdout.readableEnded).toBe(true)
      expect(worker.stderr.readableEnded).toBe(true)
      expect(() => process.kill(-identity.pid, 0)).toThrow(
        expect.objectContaining({ code: 'ESRCH' }),
      )
      // This is an availability counterexample, NOT a successful native/recovery qualification.
      // The sibling is our separate original ChildProcess, never a census-adopted signal target.
      expect(observeWorkerOutputRelease(identity)).toBe(false)
    } finally {
      worker.stdin.end()
      worker.stdout.resume()
      worker.stderr.resume()
      await workerClosed
      if (foreign) {
        foreign.stdin?.end()
        foreign.stdout?.resume()
        foreign.stderr?.resume()
        await foreignClosed
      }
      rmSync(root, { recursive: true })
    }
  },
  15_000,
)
