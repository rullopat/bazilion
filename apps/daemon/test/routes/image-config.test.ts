import type { ServiceConfigResponse } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { IMAGE_MODEL_CHOICES, IMAGE_MODELS } from '../../src/core/image-generation-config.ts'
import { isSetupComplete, openSecrets } from '../../src/core/index.ts'
import { configRouter } from '../../src/routes/config.ts'
import { clearCredentials, saveLoginCredentials } from '../../src/runtime/auth/openai-codex.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
vi.mock('../../src/lib/ctx.ts', () => ({
  getCtx: () => ({ db: env.db, paths: env.paths, authToken: 'test-only' }),
}))
beforeEach(() => {
  env = makeTestEnv()
  for (const key of [
    'BAZILION_IMAGE_GENERATION',
    'BAZILION_IMAGE_MODEL',
    'OPENROUTER_API_KEY',
    'OPENAI_API_KEY',
  ])
    vi.stubEnv(key, undefined)
})
afterEach(() => {
  env.cleanup()
  vi.unstubAllEnvs()
})
const set = (key: string, value: string) =>
  configRouter.request(`/fields/${key}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value }),
  })
async function card() {
  const body = (await (await configRouter.request('/services')).json()) as ServiceConfigResponse
  const service = body.services.find((service) => service.id === 'image-generation')
  if (!service) throw new Error('Missing image service')
  return service
}

test('automatic image status switches only through text-provider enablement and never enables images itself', async () => {
  const enable = async (provider: string, enabled: boolean) => {
    expect(
      (
        await configRouter.request(`/providers/${provider}/enabled`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled }),
        })
      ).status,
    ).toBe(200)
  }
  openSecrets(env.db, 'test-only').set('OPENAI_API_KEY', 'direct-private')
  saveLoginCredentials(env.db, 'test-only', {
    access: 'oauth-private',
    refresh: 'refresh-private',
    expires: Date.now() + 3600000,
  })
  await enable('openai', true)
  expect((await card()).status).toBe('Image generation is off.')
  await enable('openai', false)
  await set('BAZILION_IMAGE_GENERATION', 'on')
  expect((await card()).status).toContain('enable OpenAI API key or ChatGPT/Codex for text first')
  await enable('openai', true)
  expect((await card()).status).toContain('via OpenAI API key')
  expect((await card()).status).toContain('Automatic selection')
  // Resolving automatic mode must not rewrite a saved image choice behind the user's back.
  expect((await card()).fields[0]?.value).toBe('')
  await enable('openai', false)
  await enable('openai-codex', true)
  expect((await card()).status).toContain('via ChatGPT/Codex login')
  await enable('openai', true)
  expect((await card()).status).toContain('both OpenAI text providers')
  await set('BAZILION_IMAGE_MODEL', 'openai:gpt-image-2')
  expect((await card()).status).toContain('via OpenAI API key')
  await set('BAZILION_IMAGE_MODEL', 'auto')
  expect((await card()).status).toContain('both OpenAI text providers')
  expect(isSetupComplete(env.db)).toBe(false)
})

test('direct API-key and ChatGPT image selections expose distinct readiness without testing entitlement', async () => {
  await set('BAZILION_IMAGE_GENERATION', 'on')
  await set('BAZILION_IMAGE_MODEL', 'openai:gpt-image-2')
  expect((await card()).status).toContain('OPENAI_API_KEY')
  openSecrets(env.db, 'test-only').set('OPENAI_API_KEY', 'direct-private')
  expect((await card()).status).toContain('OpenAI API key')
  await set('BAZILION_IMAGE_MODEL', 'openai-codex:gpt-image-2')
  expect((await card()).status).toContain('Connect ChatGPT')
  saveLoginCredentials(env.db, 'test-only', {
    access: 'oauth-private',
    refresh: 'refresh-private',
    expires: Date.now() + 3600000,
  })
  const ready = await card()
  expect(ready.status).toContain('ChatGPT/Codex login')
  expect(ready.status).toContain('entitlement is not yet tested')
  expect(JSON.stringify(ready)).not.toMatch(/direct-private|oauth-private|refresh-private/)
  expect(isSetupComplete(env.db)).toBe(false)
  clearCredentials(env.db, 'test-only')
  expect((await card()).status).toContain('Connect ChatGPT')
})

test('web and CLI consume one closed image-model selection and truthful credential status', async () => {
  expect((await card()).status).toBe('Image generation is off.')
  expect((await card()).fields[0]?.options).toEqual(IMAGE_MODEL_CHOICES)
  expect((await set('BAZILION_IMAGE_MODEL', 'arbitrary-model')).status).toBe(400)
  expect((await set('BAZILION_IMAGE_GENERATION', 'true')).status).toBe(400)
  expect((await set('BAZILION_IMAGE_MODEL', IMAGE_MODELS[0])).status).toBe(200)
  expect((await set('BAZILION_IMAGE_GENERATION', 'on')).status).toBe(200)
  expect((await card()).status).toContain('OPENROUTER_API_KEY')
  openSecrets(env.db, 'test-only').set('OPENROUTER_API_KEY', 'test-key-private')
  const ready = await card()
  expect(ready.status).toContain(`Ready: ${IMAGE_MODELS[0]} via OpenRouter`)
  expect(JSON.stringify(ready)).not.toContain('test-key-private')
  expect(isSetupComplete(env.db)).toBe(false)
  expect(
    (
      await configRouter.request('/providers/openrouter/models', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ models: [IMAGE_MODELS[0]] }),
      })
    ).status,
  ).toBe(400)
  expect(isSetupComplete(env.db)).toBe(false)
  expect((await set('BAZILION_IMAGE_GENERATION', '')).status).toBe(200)
  expect((await card()).status).toBe('Image generation is off.')
})
