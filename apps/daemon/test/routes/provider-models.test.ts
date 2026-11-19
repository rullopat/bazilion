import { DEFAULT_PROFILE_ID, type SetProviderModelsResponse } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createProfile, profileRepo, providerStateRepo } from '../../src/core/index.ts'
import { configRouter } from '../../src/routes/config.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
vi.mock('../../src/lib/ctx.ts', () => ({
  getCtx: () => ({ db: env.db, paths: env.paths, authToken: 'test-only' }),
}))
beforeEach(() => {
  env = makeTestEnv()
})
afterEach(() => env.cleanup())

async function saveModels(provider: string, models: string[]) {
  const response = await configRouter.request(`/providers/${provider}/models`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ models }),
  })
  expect(response.status).toBe(200)
  return (await response.json()) as SetProviderModelsResponse
}
const modelOf = (id: string) => profileRepo.get(env.db, id)?.defaultModel

test('a template follows its model out of the curated list', async () => {
  providerStateRepo.setEnabled(env.db, 'anthropic', true)
  expect(await saveModels('anthropic', ['mistyped'])).toEqual({
    models: ['mistyped'],
    movedTemplates: [],
  })
  // First-run setup seeds the default template from the list.
  expect(modelOf(DEFAULT_PROFILE_ID)).toBe('anthropic:mistyped')
  createProfile(env.db, env.paths, { id: 'pinned', defaultModel: 'anthropic:never-curated' })

  expect(await saveModels('anthropic', ['corrected', 'second'])).toEqual({
    models: ['corrected', 'second'],
    movedTemplates: [{ id: DEFAULT_PROFILE_ID, name: 'Default', model: 'anthropic:corrected' }],
  })
  expect(modelOf(DEFAULT_PROFILE_ID)).toBe('anthropic:corrected')
  expect(modelOf('pinned')).toBe('anthropic:never-curated')

  // Reordering or adding removes nothing, so nothing moves.
  expect((await saveModels('anthropic', ['second', 'corrected', 'third'])).movedTemplates).toEqual(
    [],
  )
  expect(modelOf(DEFAULT_PROFILE_ID)).toBe('anthropic:corrected')
})

test('a template whose provider has no model left moves to another provider, or stays', async () => {
  providerStateRepo.setEnabled(env.db, 'anthropic', true)
  await saveModels('anthropic', ['only'])
  expect((await saveModels('anthropic', [])).movedTemplates).toEqual([])
  expect(modelOf(DEFAULT_PROFILE_ID)).toBe('anthropic:only')

  await saveModels('anthropic', ['only'])
  providerStateRepo.setEnabled(env.db, 'openai', true)
  await saveModels('openai', ['other'])
  expect((await saveModels('anthropic', [])).movedTemplates).toEqual([
    { id: DEFAULT_PROFILE_ID, name: 'Default', model: 'openai:other' },
  ])
})
