import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import {
  type BazilionDb,
  openDb,
  openSecrets,
  resolvePaths,
  runMigrations,
} from '../../src/core/index.ts'
import {
  clearCredentials,
  getStatus,
  hasCredentials,
  loadAccessToken,
  OPENAI_CODEX_SECRET_KEY,
  saveLoginCredentials,
} from '../../src/runtime/auth/openai-codex.ts'

// These tests exercise the storage + expiry logic directly. Pi-ai's network
// calls (login flow + token refresh) are out of scope and not hit — the
// refresh path is driven by a shimmed stored refresh token so we can assert
// behaviour before expiry without the wire.

let home: string
let db: BazilionDb
let authToken: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'bazilion-oauth-test-'))
  const paths = resolvePaths(home)
  mkdirSync(paths.home, { recursive: true })
  // Stamp out an auth.json with a fake bootstrap token — secretsRepo derives
  // its PBKDF2 key from this string, so encryption round-trip works.
  authToken = randomBytes(24).toString('hex')
  writeFileSync(paths.authFile, JSON.stringify({ token: authToken }))
  db = openDb(paths.db)
  runMigrations(db)
})
afterEach(() => {
  db.close()
  rmSync(home, { recursive: true, force: true })
})

function fakeAccessJwt(accountId: string): string {
  // A minimal three-part JWT so decodeAccountId can extract the chatgpt_account_id
  // from the JSON claim. Signature isn't validated locally.
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: accountId } }),
  ).toString('base64url')
  return `${header}.${payload}.sig`
}

test('hasCredentials / getStatus return disconnected on a fresh home', () => {
  expect(hasCredentials(db, authToken)).toBe(false)
  const status = getStatus(db, authToken)
  expect(status).toEqual({ connected: false, expiresAt: null, accountId: null })
})

test('saveLoginCredentials persists and getStatus reflects it', () => {
  saveLoginCredentials(db, authToken, {
    refresh: 'refresh-token',
    access: fakeAccessJwt('acct-abc'),
    expires: Date.now() + 30 * 60_000,
  })
  expect(hasCredentials(db, authToken)).toBe(true)
  const status = getStatus(db, authToken)
  expect(status.connected).toBe(true)
  expect(status.accountId).toBe('acct-abc')
  expect(status.expiresAt).toBeGreaterThan(Date.now())
})

test('loadAccessToken returns the stored access when still fresh', async () => {
  const access = fakeAccessJwt('acct-abc')
  saveLoginCredentials(db, authToken, {
    refresh: 'refresh-token',
    access,
    expires: Date.now() + 30 * 60_000,
  })
  await expect(loadAccessToken(db, authToken)).resolves.toBe(access)
})

test('loadAccessToken throws a helpful error when not configured', async () => {
  await expect(loadAccessToken(db, authToken)).rejects.toThrow(/not configured/)
})

test('clearCredentials wipes the stored blob', () => {
  saveLoginCredentials(db, authToken, {
    refresh: 'r',
    access: fakeAccessJwt('x'),
    expires: Date.now() + 60_000,
  })
  expect(hasCredentials(db, authToken)).toBe(true)
  clearCredentials(db, authToken)
  expect(hasCredentials(db, authToken)).toBe(false)
})

test('credential blob is stored under OPENAI_CODEX_SECRET_KEY and decrypts to JSON', () => {
  const access = fakeAccessJwt('acct-1')
  saveLoginCredentials(db, authToken, { refresh: 'r1', access, expires: 1000 })
  const secrets = openSecrets(db, authToken)
  const raw = secrets.get(OPENAI_CODEX_SECRET_KEY)
  expect(raw).toBeTruthy()
  const parsed = JSON.parse(raw as string)
  expect(parsed).toEqual({ refresh: 'r1', access, expires: 1000 })
})

test('malformed blob is treated as disconnected', () => {
  const secrets = openSecrets(db, authToken)
  secrets.set(OPENAI_CODEX_SECRET_KEY, 'not-json{')
  expect(hasCredentials(db, authToken)).toBe(false)
  expect(getStatus(db, authToken).connected).toBe(false)
})
