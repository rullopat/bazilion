import { afterEach, beforeEach, expect, test } from 'vitest'
import {
  type BazilionDb,
  openInMemoryDb,
  providerStateRepo,
  runMigrations,
} from '../../src/core/index.ts'

let db: BazilionDb

beforeEach(() => {
  db = openInMemoryDb()
  runMigrations(db)
})
afterEach(() => {
  db.close()
})

test('absent rows default to disabled', () => {
  expect(providerStateRepo.isEnabled(db, 'anthropic')).toBe(false)
  expect(providerStateRepo.listEnabled(db).size).toBe(0)
})

test('setEnabled inserts on first call, updates on subsequent', () => {
  providerStateRepo.setEnabled(db, 'anthropic', true)
  expect(providerStateRepo.isEnabled(db, 'anthropic')).toBe(true)

  providerStateRepo.setEnabled(db, 'anthropic', false)
  expect(providerStateRepo.isEnabled(db, 'anthropic')).toBe(false)

  providerStateRepo.setEnabled(db, 'anthropic', true)
  providerStateRepo.setEnabled(db, 'openai', true)
  providerStateRepo.setEnabled(db, 'groq', false)

  expect(providerStateRepo.listEnabled(db)).toEqual(new Set(['anthropic', 'openai']))
})
