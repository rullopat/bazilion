import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { stageNativeEntry } from '../../src/lib/native-execution/artifacts.ts'

async function fixture(visit: (root: string) => void) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-artifacts-')))
  try {
    visit(root)
    rmSync(root, { recursive: true })
  } catch (cause) {
    throw new Error(`Native artifact staging failed; retained ${root}`, { cause })
  }
}
test('fixed Linux source entry becomes readonly pinned JavaScript outside confinement', async () => {
  await fixture((root) => {
    const control = join(root, 'control')
    mkdirSync(control, { mode: 0o700 })
    const staged = stageNativeEntry(control, 'linux-bwrap')
    try {
      expect(readdirSync(control)).toEqual(['native-linux-entry.mjs'])
      expect(staged.fingerprint).toMatch(/^[a-f0-9]{64}$/)
      expect(staged.files).toHaveLength(1)
      staged.files[0]?.revalidate()
      expect(readFileSync(staged.entryPath, 'utf8')).not.toContain('enum ')
      // Invalid startup refuses before execve; this is packaging only, not sandbox qualification.
      const result = spawnSync(process.execPath, ['--jitless', staged.entryPath], {
        env: { PATH: '/usr/bin:/bin', LANG: 'C' },
        encoding: 'utf8',
        timeout: 5000,
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Native entry unavailable')
      expect(result.stderr).not.toContain('ERR_WEBASSEMBLY_NOT_SUPPORTED')
    } finally {
      staged.close()
    }
  })
})
test('fixed Darwin dependency graph contains only staged .mjs edges and builtin imports', async () => {
  await fixture((root) => {
    const control = join(root, 'control')
    mkdirSync(control, { mode: 0o700 })
    const staged = stageNativeEntry(control, 'darwin-seatbelt')
    try {
      expect(staged.files).toHaveLength(5)
      for (const file of staged.files) {
        file.revalidate()
        const text = readFileSync(file.fd, 'utf8')
        expect(text).not.toMatch(/from ['"][^'"]+\.ts['"]/)
        expect(text).not.toMatch(/constructor\(private /)
      }
    } finally {
      staged.close()
    }
  })
})
test('staging rejects shared/writable or nonempty control slots instead of substituting another layout', async () => {
  await fixture((root) => {
    const control = join(root, 'control')
    mkdirSync(control, { mode: 0o755 })
    chmodSync(control, 0o755)
    expect(() => stageNativeEntry(control, 'linux-bwrap')).toThrow('refused')
    chmodSync(control, 0o700)
    writeFileSync(join(control, 'existing'), 'operator data')
    expect(() => stageNativeEntry(control, 'linux-bwrap')).toThrow('refused')
    expect(readFileSync(join(control, 'existing'), 'utf8')).toBe('operator data')
  })
})
