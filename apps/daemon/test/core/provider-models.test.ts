import { afterEach, beforeEach, expect, test } from 'vitest'
import {
  type BazilionDb,
  openInMemoryDb,
  providerModelRepo,
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

test('listAll groups by provider and omits empties', () => {
  providerModelRepo.replace(db, 'openai', ['gpt-4o'])
  providerModelRepo.replace(db, 'anthropic', ['claude-opus-4-6', 'claude-sonnet-4-6'])
  expect(providerModelRepo.listAll(db)).toEqual({
    anthropic: ['claude-opus-4-6', 'claude-sonnet-4-6'],
    openai: ['gpt-4o'],
  })
})

test('remove drops a single entry', () => {
  providerModelRepo.replace(db, 'groq', ['llama-3.3-70b', 'mixtral-8x7b'])
  providerModelRepo.remove(db, 'groq', 'mixtral-8x7b')
  expect(providerModelRepo.list(db, 'groq')).toEqual(['llama-3.3-70b'])
  providerModelRepo.remove(db, 'groq', 'not-present')
  expect(providerModelRepo.list(db, 'groq')).toEqual(['llama-3.3-70b'])
})
