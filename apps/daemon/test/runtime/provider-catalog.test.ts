import { getBuiltinModels, getBuiltinProviders } from '@earendil-works/pi-ai/providers/all'
import { expect, test } from 'vitest'
import { PROVIDERS, piProviderName } from '../../src/core/providers.ts'
import { listCatalogModels, listCatalogModelsSync } from '../../src/runtime/providers/catalog.ts'
import { startMockServer } from './mock-server.ts'

test('catalog lookups use Pi provider ids where they differ', () => {
  expect(listCatalogModelsSync('azure-openai').length).toBeGreaterThan(0)
  expect(listCatalogModelsSync('bedrock').length).toBeGreaterThan(0)
  expect(listCatalogModelsSync('lmstudio')).toEqual([])
})

// Fails after a Pi upgrade that adds a chat provider or renames one (azure-openai -> azure).
test('the provider table covers every Pi chat provider, and each hosted entry has a catalog', () => {
  const covered = new Set(PROVIDERS.map((provider) => piProviderName(provider.id)))
  const piChatProviders = getBuiltinProviders().filter(
    (id) => getBuiltinModels(id as Parameters<typeof getBuiltinModels>[0]).length > 0,
  )
  expect(piChatProviders.filter((id) => !covered.has(id))).toEqual([])
  expect(
    PROVIDERS.filter(
      (provider) => !provider.local && listCatalogModelsSync(provider.id).length === 0,
    ).map((provider) => provider.id),
  ).toEqual([])
})

test('a local server lists its loaded models live; a hosted API without a listing does not', async () => {
  const seen: string[] = []
  const mock = await startMockServer((req) => {
    seen.push(new URL(req.url).pathname)
    return Response.json({ data: [{ id: 'qwen3-coder-30b' }, { id: 'gemma-4' }] })
  })
  try {
    await expect(
      listCatalogModels('lmstudio', { LMSTUDIO_URL: `${mock.url}/v1` }),
    ).resolves.toEqual({ catalog: [], live: { models: ['qwen3-coder-30b', 'gemma-4'] } })
    expect(seen).toEqual(['/v1/models'])
    const anthropic = await listCatalogModels('anthropic', {})
    expect(anthropic.live).toBeUndefined()
    expect(anthropic.catalog.length).toBeGreaterThan(0)
  } finally {
    await mock.stop()
  }
})
