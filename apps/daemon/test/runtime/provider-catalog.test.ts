import { expect, test } from 'vitest'
import { listCatalogModelsSync } from '../../src/runtime/providers/catalog.ts'

test('Bazilion Azure catalog retains its provider id across the upstream Azure rename', () => {
  expect(listCatalogModelsSync('azure-openai')).toEqual(
    expect.arrayContaining(['gpt-6.1-sol', 'deepseek-v4-pro']),
  )
})

test('Pi catalog exposes Astra and GPT-5.6 for API-key and ChatGPT OAuth providers', () => {
  const family = ['gpt-6-astra', 'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra']
  expect(listCatalogModelsSync('openai')).toEqual(expect.arrayContaining(family))
  expect(listCatalogModelsSync('openai-codex')).toEqual(expect.arrayContaining(family))
})
