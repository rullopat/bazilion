import { expect, test } from 'vitest'
import {
  validateCodingCommand,
  validateCodingEnvironmentConfig,
} from '../../src/core/coding-environment/config.ts'
import { openInMemoryDb } from '../../src/core/db/client.ts'
import { runMigrations } from '../../src/core/db/migrate.ts'
import {
  getCodingEnvironment,
  putCodingEnvironment,
} from '../../src/core/repos/coding-environment.ts'

const config = { image: 'local/node:24', cwd: 'app source', env: { CI: 'true' } }
test('optional defaults use revision CAS and reject the obsolete executable checklist', () => {
  const db = openInMemoryDb()
  runMigrations(db)
  try {
    db.raw.run("INSERT INTO teams (id,name,created_at) VALUES ('example','Example',0)")
    expect(getCodingEnvironment(db, 'example')).toBeNull()
    expect(putCodingEnvironment(db, 'example', 0, config).revision).toBe(1)
    expect(() => putCodingEnvironment(db, 'example', 0, config)).toThrow('changed')
    expect(putCodingEnvironment(db, 'example', 1, { ...config, cwd: '.' }).revision).toBe(2)
    expect(() => validateCodingEnvironmentConfig({ ...config, checks: [] })).toThrow()
  } finally {
    db.close()
  }
})
test.each([
  { ...config, env: { BASH_ENV: '/secret' } },
  { ...config, env: { CI: 'secret' } },
  { ...config, cwd: '../outside' },
  { ...config, image: '--privileged' },
])('rejects unsafe defaults without echoing input', (input) => {
  expect(() => validateCodingEnvironmentConfig(input)).toThrow('Invalid coding environment')
})
test('ad hoc commands are finite, scoped and independent of saved settings', () => {
  const command = { command: 'pnpm test', cwd: 'app', purpose: 'test', timeoutSeconds: 30 }
  expect(validateCodingCommand(command)).toEqual(command)
  for (const patch of [
    { cwd: '../escape' },
    { timeoutSeconds: 301 },
    { timeoutSeconds: 0 },
    { purpose: 'deploy' },
    { image: 'host' },
    { command: 'x'.repeat(4097) },
  ])
    expect(() => validateCodingCommand({ ...command, ...patch })).toThrow()
})
