import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import {
  prepareNativeRuntime,
  retainNativeRuntime,
} from '../../src/lib/native-execution/runtime.ts'
import { snapshotNativeViewOptions } from '../../src/lib/native-execution/view-options.ts'
import { nativeIntegrationEnabled } from '../fixtures/native-platform.ts'

// These two cases capture the actual installed backend, not a dependency-free unit fixture.
const nativeRuntimeTest = test.skipIf(!nativeIntegrationEnabled)

async function fixture(visit: (root: string) => Promise<void>) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-runtime-')))
  try {
    await visit(root)
    rmSync(root, { recursive: true })
  } catch (cause) {
    throw new Error(`Frozen native runtime failed; retained ${root}`, { cause })
  }
}
nativeRuntimeTest(
  'frozen runtime facts exclude private staging paths and retained loans defer closure',
  async () => {
    await fixture(async (root) => {
      const first = join(root, 'one'),
        second = join(root, 'two')
      mkdirSync(first, { mode: 0o700 })
      mkdirSync(second, { mode: 0o700 })
      const a = await prepareNativeRuntime(first),
        b = await prepareNativeRuntime(second)
      try {
        expect(a.facts).toEqual(b.facts)
        expect(JSON.stringify(a.facts)).not.toContain(root)
        expect(() => retainNativeRuntime({ ...a })).toThrow('refused')
        const loan = retainNativeRuntime(a)
        expect(a.close()).toBe(false)
        expect(() => retainNativeRuntime(a)).toThrow('refused')
        await a.revalidate()
        loan.release()
        expect(a.close()).toBe(true)
        await expect(a.revalidate()).rejects.toThrow('refused')
      } finally {
        a.close()
        b.close()
      }
    })
  },
)
nativeRuntimeTest(
  'staged trusted code drift refuses instead of refreshing a frozen runtime',
  async () => {
    await fixture(async (root) => {
      const control = join(root, 'runtime')
      mkdirSync(control, { mode: 0o700 })
      const runtime = await prepareNativeRuntime(control),
        fingerprint = runtime.facts.fingerprint
      try {
        chmodSync(runtime.entry.entryPath, 0o600)
        writeFileSync(runtime.entry.entryPath, 'modified controlled template')
        await expect(runtime.revalidate()).rejects.toThrow('refused')
        expect(runtime.facts.fingerprint).toBe(fingerprint)
      } finally {
        expect(runtime.close()).toBe(true)
      }
    })
  },
)
test('view role/config snapshots cannot adopt later mutations to the caller object', () => {
  const source = {
    root: '/private/job',
    workspace: '/workspace',
    cwd: '.',
    env: { CI: 'true' },
    readOnlyDirectories: ['/skill'],
    readOnlyFiles: [{ path: '/input', executable: false }],
    unavailable: [{ path: '/private/state', kind: 'directory' as const }],
  }
  const captured = snapshotNativeViewOptions(source)
  source.workspace = '/different'
  source.env.CI = 'false'
  const file = source.readOnlyFiles[0]
  if (!file) throw new Error('missing controlled file')
  file.executable = true
  source.readOnlyDirectories.push('/personal')
  expect(captured.workspace).toBe('/workspace')
  expect(captured.env).toEqual({ CI: 'true' })
  expect(captured.readOnlyDirectories).toEqual(['/skill'])
  expect(captured.readOnlyFiles[0]?.executable).toBe(false)
})
