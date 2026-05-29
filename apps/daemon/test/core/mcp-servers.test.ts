import { beforeEach, expect, test } from 'vitest'
import { type BazilionDb, openInMemoryDb } from '../../src/core/db/client.ts'
import { runMigrations } from '../../src/core/db/migrate.ts'
import * as mcpServerRepo from '../../src/core/repos/mcpServers.ts'

let db: BazilionDb

beforeEach(() => {
  db = openInMemoryDb()
  runMigrations(db)
})

test('insert + get a stdio server', () => {
  const s = mcpServerRepo.insert(db, {
    name: 'playwright',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@playwright/mcp'],
  })
  expect(s.id).toBeTruthy()
  expect(s.transport).toBe('stdio')
  expect(s.args).toEqual(['-y', '@playwright/mcp'])
  expect(s.enabled).toBe(true)
  expect(s.hasAuthToken).toBe(false)

  const fetched = mcpServerRepo.get(db, s.id)
  expect(fetched?.name).toBe('playwright')
})

test('http server carries url + hasAuth flag', () => {
  const s = mcpServerRepo.insert(db, {
    name: 'remote',
    transport: 'http',
    url: 'https://mcp.example.com',
    hasAuth: true,
  })
  expect(s.url).toBe('https://mcp.example.com')
  expect(s.hasAuthToken).toBe(true)
  expect(s.command).toBeNull()
})

test('getByName + unique listing', () => {
  mcpServerRepo.insert(db, { name: 'a', transport: 'stdio', command: 'a' })
  mcpServerRepo.insert(db, { name: 'b', transport: 'stdio', command: 'b' })
  expect(mcpServerRepo.getByName(db, 'a')?.name).toBe('a')
  expect(mcpServerRepo.getByName(db, 'missing')).toBeNull()
  expect(mcpServerRepo.list(db).map((s) => s.name)).toEqual(['a', 'b'])
})

test('listEnabled excludes disabled servers', () => {
  const a = mcpServerRepo.insert(db, { name: 'a', transport: 'stdio', command: 'a' })
  mcpServerRepo.insert(db, { name: 'b', transport: 'stdio', command: 'b' })
  mcpServerRepo.setEnabled(db, a.id, false)
  expect(mcpServerRepo.listEnabled(db).map((s) => s.name)).toEqual(['b'])
})

test('update merges fields and bumps updated_at', () => {
  const s = mcpServerRepo.insert(db, { name: 'a', transport: 'stdio', command: 'a', args: ['x'] })
  const updated = mcpServerRepo.update(db, s.id, {
    name: 'renamed',
    args: ['y', 'z'],
    hasAuth: true,
  })
  expect(updated?.name).toBe('renamed')
  expect(updated?.args).toEqual(['y', 'z'])
  expect(updated?.command).toBe('a') // untouched
  expect(updated?.hasAuthToken).toBe(true)
})

test('remove deletes the row', () => {
  const s = mcpServerRepo.insert(db, { name: 'a', transport: 'stdio', command: 'a' })
  mcpServerRepo.remove(db, s.id)
  expect(mcpServerRepo.get(db, s.id)).toBeNull()
})

test('duplicate name violates the unique constraint', () => {
  mcpServerRepo.insert(db, { name: 'dup', transport: 'stdio', command: 'a' })
  expect(() =>
    mcpServerRepo.insert(db, { name: 'dup', transport: 'stdio', command: 'b' }),
  ).toThrow()
})
