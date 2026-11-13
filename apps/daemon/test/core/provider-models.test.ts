import { afterEach, beforeEach, expect, test } from 'vitest'
import {
  type BazilionDb,
  initSchema,
  openInMemoryDb,
  providerModelRepo,
} from '../../src/core/index.ts'

let db: BazilionDb

beforeEach(() => {
  db = openInMemoryDb('')
  initSchema(db)
})
afterEach(() => {
  db.close()
})

test('replace seeds, round-trips, and overwrites', () => {
  expect(providerModelRepo.list(db, 'openai')).toEqual([])

  providerModelRepo.replace(db, 'openai', ['gpt-4o', 'gpt-4o-mini', 'o1'])
  expect(providerModelRepo.list(db, 'openai')).toEqual(['gpt-4o', 'gpt-4o-mini', 'o1'])

  providerModelRepo.replace(db, 'openai', ['gpt-5'])
  expect(providerModelRepo.list(db, 'openai')).toEqual(['gpt-5'])

  providerModelRepo.replace(db, 'openai', [])
  expect(providerModelRepo.list(db, 'openai')).toEqual([])
})

test('replace trims whitespace and drops empties + duplicates', () => {
  providerModelRepo.replace(db, 'anthropic', [
    '  claude-opus-4-6  ',
    '',
    'claude-sonnet-4-6',
    'claude-opus-4-6',
  ])
  expect(providerModelRepo.list(db, 'anthropic')).toEqual(['claude-opus-4-6', 'claude-sonnet-4-6'])
})
