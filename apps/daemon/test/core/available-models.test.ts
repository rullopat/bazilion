import { afterEach, beforeEach, expect, test } from 'vitest'
import {
  type BazilionDb,
  groupAvailableModels,
  listAvailableModels,
  openInMemoryDb,
  providerModelRepo,
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

test('empty DB yields empty lists', () => {
  expect(listAvailableModels(db)).toEqual([])
  expect(groupAvailableModels(db)).toEqual([])
})

test('only enabled providers with curated models surface', () => {
  providerStateRepo.setEnabled(db, 'anthropic', true)
  providerStateRepo.setEnabled(db, 'openai', true)
  providerStateRepo.setEnabled(db, 'groq', false)
  providerStateRepo.setEnabled(db, 'lmstudio', true)

  providerModelRepo.replace(db, 'anthropic', ['claude-opus-4-6', 'claude-sonnet-4-6'])
  providerModelRepo.replace(db, 'openai', ['gpt-4o'])
  // openai but disabled-then-enabled — still has its curated entries
  providerModelRepo.replace(db, 'groq', ['llama-3.3-70b']) // disabled → omitted
  // lmstudio is enabled but has no curated models → omitted from teams

  const list = listAvailableModels(db)
  expect(list.map((m) => m.value).sort()).toEqual([
    'anthropic:claude-opus-4-6',
    'anthropic:claude-sonnet-4-6',
    'openai:gpt-4o',
  ])

  const teams = groupAvailableModels(db)
  expect(teams).toEqual([
    { provider: 'anthropic', models: ['claude-opus-4-6', 'claude-sonnet-4-6'] },
    { provider: 'openai', models: ['gpt-4o'] },
  ])
})

test('disabling a provider makes its curated models disappear from the list', () => {
  providerStateRepo.setEnabled(db, 'anthropic', true)
  providerModelRepo.replace(db, 'anthropic', ['claude-opus-4-6'])
  expect(listAvailableModels(db)).toHaveLength(1)

  providerStateRepo.setEnabled(db, 'anthropic', false)
  expect(listAvailableModels(db)).toHaveLength(0)

  providerStateRepo.setEnabled(db, 'anthropic', true)
  expect(listAvailableModels(db)).toHaveLength(1)
})
