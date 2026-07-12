import { expect, test } from 'vitest'
import { listCatalogModelsSync } from '../../src/runtime/providers/catalog.ts'

test('Pi catalog exposes the GPT-5.6 family for API-key and ChatGPT OAuth providers', () => {
  const family = ['gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra']
  expect(listCatalogModelsSync('openai')).toEqual(expect.arrayContaining(family))
  expect(listCatalogModelsSync('openai-codex')).toEqual(expect.arrayContaining(family))
})
