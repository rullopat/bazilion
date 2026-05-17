import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { type BazilionDb, openInMemoryDb } from '../../src/core/db/client.ts'
import { runMigrations } from '../../src/core/db/migrate.ts'
import { CONFIG_KEYS, isConfigKey, openConfig } from '../../src/core/repos/config.ts'
import { openSecrets } from '../../src/core/repos/secrets.ts'
import { mergeSecretsIntoEnv } from '../../src/core/secrets.ts'

interface Env {
  home: string
  db: BazilionDb
  authToken: string
  cleanup(): void
}

function makeEnv(): Env {
  const home = mkdtempSync(join(tmpdir(), 'bazilion-config-'))
  const db = openInMemoryDb()
  runMigrations(db)
  return {
    home,
    db,
    authToken: 'test-token-abc123',
    cleanup() {
      db.close()
      rmSync(home, { recursive: true, force: true })
    },
  }
}

let env: Env

beforeEach(() => {
  env = makeEnv()
})
afterEach(() => {
  env.cleanup()
})

test('isConfigKey identifies URL-type keys and rejects secret-shaped ones', () => {
  for (const k of CONFIG_KEYS) expect(isConfigKey(k)).toBe(true)
  expect(isConfigKey('ANTHROPIC_API_KEY')).toBe(false)
  expect(isConfigKey('OPENAI_API_KEY')).toBe(false)
  expect(isConfigKey('BRAVE_API_KEY')).toBe(false)
  expect(isConfigKey('random-junk')).toBe(false)
})

test('openConfig round-trips LMSTUDIO_URL through the config table', () => {
  const config = openConfig(env.db)
  config.set('LMSTUDIO_URL', 'http://192.168.1.50:1234/v1')
  expect(config.get('LMSTUDIO_URL')).toBe('http://192.168.1.50:1234/v1')

  // Re-opening (a fresh repo over the same db) yields the same value.
  const reopened = openConfig(env.db)
  expect(reopened.get('LMSTUDIO_URL')).toBe('http://192.168.1.50:1234/v1')
})

test('openConfig rejects unknown keys to prevent accidental secret leaks', () => {
  const config = openConfig(env.db)
  expect(() => config.set('ANTHROPIC_API_KEY', 'sk-abc')).toThrow(/not a known config key/)
  expect(() => config.set('random-thing', 'x')).toThrow(/not a known config key/)
})

test('openConfig.remove clears one key without affecting siblings', () => {
  const config = openConfig(env.db)
  config.set('LMSTUDIO_URL', 'http://x')
  config.set('OLLAMA_URL', 'http://y')
  config.remove('LMSTUDIO_URL')
  expect(config.get('LMSTUDIO_URL')).toBeUndefined()
  expect(config.get('OLLAMA_URL')).toBe('http://y')
})

test('openSecrets round-trips an encrypted value with the bootstrap token', () => {
  const secrets = openSecrets(env.db, env.authToken)
  secrets.set('ANTHROPIC_API_KEY', 'sk-from-secrets')
  expect(secrets.get('ANTHROPIC_API_KEY')).toBe('sk-from-secrets')

  // A different password fails to decrypt — get returns undefined rather
  // than throwing.
  const wrongPass = openSecrets(env.db, 'wrong-token')
  expect(wrongPass.get('ANTHROPIC_API_KEY')).toBeUndefined()
})

test('mergeSecretsIntoEnv layers process env over secrets over config', () => {
  const config = openConfig(env.db)
  config.set('LMSTUDIO_URL', 'http://from-config')

  const secrets = openSecrets(env.db, env.authToken)
  secrets.set('ANTHROPIC_API_KEY', 'sk-from-secrets')

  // process env beats both.
  const merged = mergeSecretsIntoEnv(env.db, env.authToken, {
    ANTHROPIC_API_KEY: 'sk-from-env',
  } as NodeJS.ProcessEnv)
  expect(merged.LMSTUDIO_URL).toBe('http://from-config')
  expect(merged.ANTHROPIC_API_KEY).toBe('sk-from-env')
})
