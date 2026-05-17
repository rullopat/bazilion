import { beforeEach, describe, expect, test } from 'vitest'
import {
  type BazilionDb,
  openInMemoryDb,
  runMigrations,
  skillMetaRepo,
} from '../../src/core/index.ts'

let db: BazilionDb
beforeEach(() => {
  db = openInMemoryDb()
  runMigrations(db)
})

describe('skillMetaRepo', () => {
  test('get returns null when no row exists', () => {
    expect(skillMetaRepo.get(db, 'missing')).toBe(null)
  })

  test('upsert creates a row with defaults', () => {
    const m = skillMetaRepo.upsert(db, { name: 'alpha' })
    expect(m).toEqual({ name: 'alpha', source: null, importedAt: null })
    expect(skillMetaRepo.get(db, 'alpha')).toEqual(m)
  })

  test('upsert updates source + importedAt without clobbering the name', () => {
    skillMetaRepo.upsert(db, { name: 'alpha' })
    const m = skillMetaRepo.upsert(db, { name: 'alpha', source: 'openclaw', importedAt: 123 })
    expect(m).toEqual({ name: 'alpha', source: 'openclaw', importedAt: 123 })
  })

  test('listAll returns rows sorted by name', () => {
    skillMetaRepo.upsert(db, { name: 'zebra' })
    skillMetaRepo.upsert(db, { name: 'alpha' })
    skillMetaRepo.upsert(db, { name: 'mid', source: 'path' })
    const rows = skillMetaRepo.listAll(db)
    expect(rows.map((r) => r.name)).toEqual(['alpha', 'mid', 'zebra'])
  })

  test('remove drops the row', () => {
    skillMetaRepo.upsert(db, { name: 'tmp' })
    skillMetaRepo.remove(db, 'tmp')
    expect(skillMetaRepo.get(db, 'tmp')).toBe(null)
  })
})
