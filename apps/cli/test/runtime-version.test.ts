import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from 'vitest'
import {
  SUPPORTED_NODE_RANGE as daemonRange,
  isSupportedNodeVersion as daemonSupports,
} from '../../daemon/src/runtime-version.ts'
import { isSupportedNodeVersion, SUPPORTED_NODE_RANGE } from '../src/runtime-version.ts'

test('runtime guards agree on the explicitly supported fixed release lines', () => {
  expect(SUPPORTED_NODE_RANGE).toBe('^26.12.1')
  expect(daemonRange).toBe(SUPPORTED_NODE_RANGE)
  for (const version of ['26.12.1', '26.12.2', '26.13.0', '26.99.0']) {
    expect(isSupportedNodeVersion(version), version).toBe(true)
    expect(daemonSupports(version), version).toBe(true)
  }
})

test('runtime guards refuse old and unqualified major lines without a fallback', () => {
  for (const version of [
    '22.23.2',
    '24.0.0',
    '24.20.0',
    '24.21.99',
    '24.22.0',
    '24.99.0',
    '25.7.0',
    '26.0.0',
    '26.3.99',
    '26.4.0',
    '26.8.0',
    '26.9.0',
    '26.11.99',
    '26.12.0',
    '27.0.0',
  ]) {
    expect(isSupportedNodeVersion(version), version).toBe(false)
    expect(daemonSupports(version), version).toBe(false)
  }
})

test('runtime guards refuse malformed and prerelease declarations', () => {
  for (const version of [
    '',
    'v26.12.1',
    '26.12',
    '26.12.1-rc.1',
    '26.12.1+custom',
    '026.12.1',
    '26.012.1',
    '26.12.01',
    '26.12.1\n',
    ' 26.12.1',
    '26.12.9007199254740992',
  ]) {
    expect(isSupportedNodeVersion(version), JSON.stringify(version)).toBe(false)
    expect(daemonSupports(version), JSON.stringify(version)).toBe(false)
  }
})

test('source launchers guard before dynamically linking application payloads', () => {
  for (const entry of ['../src/index.ts', '../../daemon/src/index.ts']) {
    const source = readFileSync(join(import.meta.dirname, entry), 'utf8')
    expect(source.match(/^import .+$/gm)).toEqual(["import './runtime-version.ts'"])
    expect(source).toContain("await import('./main.ts')")
    expect(source.indexOf("import './runtime-version.ts'")).toBeLessThan(
      source.indexOf("await import('./main.ts')"),
    )
  }
})

for (const [surface, entry] of [
  ['CLI', '../src/index.ts'],
  ['daemon', '../../daemon/src/index.ts'],
] as const) {
  test(`${surface} refuses a controlled unsupported version before home or ownership bootstrap`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'baz-runtime-version-'))
    const home = join(dir, 'home')
    const launcher = join(dir, 'declared-version.mjs')
    writeFileSync(
      launcher,
      `Object.defineProperty(process.versions, 'node', { value: '24.22.0' })\n` +
        `process.argv = [process.execPath, 'bazilion', '--version']\n` +
        `await import(${JSON.stringify(pathToFileURL(join(import.meta.dirname, entry)).href)})\n`,
    )
    let accepted = false
    try {
      // A controlled version declaration on the actual test runtime, not a
      // native crash probe or a claim that this child runs an older binary.
      const result = spawnSync(
        process.execPath,
        ['--experimental-strip-types', '--no-warnings', launcher],
        {
          env: {
            PATH: process.env.PATH,
            HOME: join(dir, 'operator-home'),
            BAZILION_HOME: home,
            HOST: '127.0.0.1',
            PORT: '0',
            BAZILION_SCHEDULER: 'off',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
          encoding: 'utf8',
          timeout: 5_000,
          killSignal: 'SIGKILL',
          maxBuffer: 64 * 1024,
        },
      )
      expect(result.error, `fixture retained at ${dir}`).toBeUndefined()
      expect(result.signal, `fixture retained at ${dir}`).toBeNull()
      expect(result.status).toBe(1)
      expect(result.stderr).toContain(`requires Node.js ${SUPPORTED_NODE_RANGE}`)
      expect(result.stderr).toContain('received 24.22.0')
      expect(existsSync(home)).toBe(false)
      expect(readdirSync(dir)).toEqual(['declared-version.mjs'])
      accepted = true
    } finally {
      if (accepted) rmSync(dir, { recursive: true })
      else console.error(`runtime refusal fixture retained at ${dir}`)
    }
  })
}
