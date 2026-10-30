import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import {
  DarwinBrowserKeychainError,
  ensureDarwinBrowserKeychain,
  prepareDarwinBrowserKeychain,
} from '../../src/lib/browser/darwin-keychain.ts'

const directories: string[] = []
function scratch() {
  const path = mkdtempSync(join(tmpdir(), 'baz-browser-keychain-'))
  directories.push(path)
  return path
}
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})

test('private browser keychain material is stable, profile-local and owner-only', () => {
  const root = scratch()
  const home = join(root, 'home')
  const first = prepareDarwinBrowserKeychain(home)
  expect(first.password).toMatch(/^[a-f0-9]{64}$/)
  expect(prepareDarwinBrowserKeychain(home)).toEqual(first)
  expect(prepareDarwinBrowserKeychain(join(root, 'other-home')).password).not.toBe(first.password)
  expect(lstatSync(join(home, '.bazilion-keychain-secret')).mode & 0o777).toBe(0o600)
  for (const path of [
    home,
    join(home, 'Library'),
    join(home, 'Library', 'Preferences'),
    join(home, 'Library', 'Keychains'),
  ])
    expect(lstatSync(path).mode & 0o777).toBe(0o700)
})

test('private browser keychain refuses redirected HOME/library/preference slots', () => {
  const root = scratch()
  const target = join(root, 'outside')
  mkdirSync(target)
  const linkedHome = join(root, 'linked-home')
  symlinkSync(target, linkedHome)
  expect(() => prepareDarwinBrowserKeychain(linkedHome)).toThrow(/unsafe/)
  const home = join(root, 'home')
  mkdirSync(home)
  symlinkSync(target, join(home, 'Library'))
  expect(() => prepareDarwinBrowserKeychain(home)).toThrow(/unsafe/)
  expect(existsSync(join(target, 'Preferences'))).toBe(false)
})

test('private browser keychain secret refuses symlinks, hardlinks and public permissions', () => {
  const home = scratch()
  prepareDarwinBrowserKeychain(home)
  const secret = join(home, '.bazilion-keychain-secret')
  chmodSync(secret, 0o644)
  expect(() => prepareDarwinBrowserKeychain(home)).toThrow(/unsafe/)
  chmodSync(secret, 0o600)
  const linked = join(home, 'linked-secret')
  linkSync(secret, linked)
  expect(() => prepareDarwinBrowserKeychain(home)).toThrow(/unsafe/)
  rmSync(linked)
  rmSync(secret)
  const target = join(home, 'external-secret')
  writeFileSync(target, 'f'.repeat(64), { mode: 0o600 })
  symlinkSync(target, secret)
  expect(() => prepareDarwinBrowserKeychain(home)).toThrow()
  expect(readFileSync(target, 'utf8')).toBe('f'.repeat(64))
})

test('private browser keychain refuses redirected native preference and database files', () => {
  const home = scratch()
  prepareDarwinBrowserKeychain(home)
  const target = join(home, 'not-native-state')
  writeFileSync(target, 'untouched')
  for (const path of [
    join(home, 'Library', 'Preferences', 'com.apple.security.plist'),
    join(home, 'Library', 'Keychains', 'bazilion.keychain-db'),
  ]) {
    symlinkSync(target, path)
    expect(() => prepareDarwinBrowserKeychain(home)).toThrow(/unsafe/)
    rmSync(path)
  }
  expect(readFileSync(target, 'utf8')).toBe('untouched')
})

test('keychain diagnostics disclose only closed native phases and numeric status', () => {
  expect(
    new DarwinBrowserKeychainError(false, JSON.stringify({ phase: 'unlock', status: -25293 }))
      .message,
  ).toContain('phase=unlock, status=-25293')
  for (const value of [
    'password=do-not-disclose',
    JSON.stringify({ phase: 'private-secret', status: 1 }),
    JSON.stringify({ phase: 'unlock', status: 'private-secret' }),
  ])
    expect(new DarwinBrowserKeychainError(false, value).message).toBe(
      'managed private browser keychain unavailable',
    )
})

test.skipIf(process.platform === 'darwin')(
  'native keychain admission refuses off macOS before filesystem mutation',
  async () => {
    const home = join(scratch(), 'not-created')
    await expect(ensureDarwinBrowserKeychain(home, 1000)).rejects.toThrow(/unavailable/)
    expect(existsSync(home)).toBe(false)
  },
)

test.skipIf(process.platform !== 'darwin')(
  'actual private native keychain survives restart without changing the caller account default',
  { timeout: 25_000 },
  async () => {
    const home = scratch()
    const defaultSnapshot = () => {
      const result = spawnSync('/usr/bin/security', ['default-keychain', '-d', 'user'], {
        encoding: 'utf8',
      })
      if (result.error) throw result.error
      if (result.signal) throw new Error('default-keychain inspection did not exit normally')
      if (result.status === 0) return { state: 'present', value: result.stdout }
      // An isolated HOME may positively have no default. Never create/change the caller's
      // keychain for this fixture, or treat denied/unknown inspection as absence.
      if (
        result.status === 1 &&
        result.stdout === '' &&
        result.stderr ===
          'security: SecKeychainCopyDomainDefault user: A default keychain could not be found.\n'
      )
        return { state: 'absent' }
      throw new Error('default-keychain inspection is unknown')
    }
    const ensure = async () => {
      try {
        await ensureDarwinBrowserKeychain(home, 8000)
      } catch (error) {
        // Do not erase scratch after an uncertain native/external-service operation.
        const index = directories.indexOf(home)
        if (index >= 0) directories.splice(index, 1)
        console.warn(`[private keychain fixture] retained failed native HOME: ${home}`)
        throw error
      }
    }
    const before = defaultSnapshot()
    const beforeSearch = execFileSync('/usr/bin/security', ['list-keychains', '-d', 'user'], {
      encoding: 'utf8',
    })
    await ensure()
    const secretDigest = createHash('sha256')
      .update(readFileSync(join(home, '.bazilion-keychain-secret')))
      .digest('hex')
    expect(existsSync(join(home, 'Library', 'Keychains', 'bazilion.keychain-db'))).toBe(true)
    await ensure()
    expect(
      createHash('sha256')
        .update(readFileSync(join(home, '.bazilion-keychain-secret')))
        .digest('hex'),
    ).toBe(secretDigest)
    expect(defaultSnapshot()).toEqual(before)
    expect(
      execFileSync('/usr/bin/security', ['list-keychains', '-d', 'user'], { encoding: 'utf8' }),
    ).toBe(beforeSearch)
  },
)
