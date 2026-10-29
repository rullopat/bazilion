import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, vi } from 'vitest'
import { nativeTrustedCodeRoot } from '../../src/lib/native-execution/artifacts.ts'
import {
  assertNativeInputs,
  captureNativeInputs,
  type NativeInputsOptions,
} from '../../src/lib/native-execution/inputs.ts'

async function fixture(visit: (options: NativeInputsOptions, root: string) => Promise<void>) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-inputs-')))
  const workspace = join(root, 'workspace'),
    skills = join(root, 'skills')
  mkdirSync(workspace)
  mkdirSync(join(workspace, 'memory'))
  mkdirSync(skills)
  writeFileSync(join(skills, 'helper.js'), 'trusted skill data')
  writeFileSync(join(workspace, 'source'), 'before')
  try {
    await visit(
      { workspace, readOnlyDirectories: [skills], readOnlyFiles: [], unavailable: [] },
      root,
    )
    rmSync(root, { recursive: true })
  } catch (cause) {
    throw new Error(`Native input safety admission failed; retained ${root}`, { cause })
  }
}

test('new safety captures admit expected workspace changes only between settled command scopes', async () => {
  await fixture(async (options) => {
    const first = await captureNativeInputs(options)
    try {
      assertNativeInputs(first)
      expect(() => assertNativeInputs({ ...first })).toThrow('refused')
      expect(first.workspace.writable).toBe(true)
      expect(first.directories.every((value) => !value.writable)).toBe(true)
      await first.revalidate()
      writeFileSync(join(options.workspace, 'source'), 'expected next-command source change')
      await expect(first.revalidate()).rejects.toThrow()
      const next = await captureNativeInputs(options)
      try {
        expect(next.fingerprint).not.toBe(first.fingerprint)
        await next.revalidate()
      } finally {
        next.close()
      }
    } finally {
      first.close()
    }
    expect(() => assertNativeInputs(first)).toThrow('refused')
  })
})
test('private roots and a readonly ancestor cannot be silently admitted through the workspace', async () => {
  await fixture(async (options, root) => {
    await expect(
      captureNativeInputs({
        ...options,
        unavailable: [{ path: join(options.workspace, 'auth.json'), kind: 'file' }],
      }),
    ).rejects.toThrow('refused')
    await expect(captureNativeInputs({ ...options, readOnlyDirectories: [root] })).rejects.toThrow(
      'refused',
    )
    await expect(
      captureNativeInputs({
        ...options,
        readOnlyDirectories: [join(root, 'skills')],
        unavailable: [{ path: join(root, 'skills', 'secret'), kind: 'file' }],
      }),
    ).rejects.toThrow('refused')
  })
})
test('writable overlap with the running trusted daemon code refuses before tree traversal', async () => {
  await expect(
    captureNativeInputs({
      workspace: nativeTrustedCodeRoot(),
      readOnlyDirectories: [],
      readOnlyFiles: [],
      unavailable: [],
    }),
  ).rejects.toThrow('refused')
})
test('memory cannot be replaced with a symlink to an unrelated readonly input', async () => {
  await fixture(async (options, root) => {
    rmSync(join(options.workspace, 'memory'), { recursive: true })
    symlinkSync(join(root, 'skills'), join(options.workspace, 'memory'))
    await expect(captureNativeInputs(options)).rejects.toThrow('refused')
  })
})
test('readonly registered aliases remain bound, not only their first canonical target', async () => {
  await fixture(async (options, root) => {
    const alias = join(root, 'selected-skill'),
      replacement = join(root, 'replacement')
    mkdirSync(replacement)
    symlinkSync(join(root, 'skills'), alias)
    const input = await captureNativeInputs({ ...options, readOnlyDirectories: [alias] })
    try {
      await input.revalidate()
      unlinkSync(alias)
      symlinkSync(replacement, alias)
      await expect(input.revalidate()).rejects.toThrow()
    } finally {
      input.close()
    }
  })
})
test('initial shared admission timer is disarmed; later validation receives a fresh bounded window', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    await fixture(async (options) => {
      const input = await captureNativeInputs(options)
      try {
        await vi.advanceTimersByTimeAsync(6000)
        await input.revalidate()
      } finally {
        input.close()
      }
    })
  } finally {
    vi.useRealTimers()
  }
})
