import type { ServiceConfigResponse } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { IMAGE_MODEL_CHOICES } from '../../src/core/image-generation-config.ts'
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
  for (const key of ['BAZILION_IMAGE_MODEL', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY'])
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

test('one image-model setting; its status says whether the chosen account is ready', async () => {
  expect((await card()).status).toBe('Image generation is off.')
  expect((await card()).fields.map((field) => field.envVar)).toEqual(['BAZILION_IMAGE_MODEL'])
  expect((await card()).fields[0]?.options).toEqual(IMAGE_MODEL_CHOICES)
  expect((await set('BAZILION_IMAGE_MODEL', 'arbitrary-model')).status).toBe(400)

  await set('BAZILION_IMAGE_MODEL', 'openai:gpt-image-2')
  expect((await card()).status).toContain('OPENAI_API_KEY')
  openSecrets(env.db, 'test-only').set('OPENAI_API_KEY', 'direct-private')
  expect((await card()).status).toBe('Ready: openai:gpt-image-2.')

  await set('BAZILION_IMAGE_MODEL', 'openai-codex:gpt-image-2')
  expect((await card()).status).toContain('ChatGPT login')
  saveLoginCredentials(env.db, 'test-only', {
    access: 'oauth-private',
    refresh: 'refresh-private',
    expires: Date.now() + 3600000,
  })
  const ready = await card()
  expect(ready.status).toBe('Ready: openai-codex:gpt-image-2.')
  expect(JSON.stringify(ready)).not.toMatch(/direct-private|oauth-private|refresh-private/)
  clearCredentials(env.db, 'test-only')
  expect((await card()).status).toContain('ChatGPT login')

  await set('BAZILION_IMAGE_MODEL', 'openrouter:google/gemini-3.1-flash-image')
  expect((await card()).status).toContain('OPENROUTER_API_KEY')
  expect((await set('BAZILION_IMAGE_MODEL', 'off')).status).toBe(200)
  expect((await card()).status).toBe('Image generation is off.')
  expect(isSetupComplete(env.db)).toBe(false)
})

test('image models cannot be added as chat models', async () => {
  expect(
    (
      await configRouter.request('/providers/openrouter/models', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ models: ['google/gemini-3.1-flash-image'] }),
      })
    ).status,
  ).toBe(400)
  expect(isSetupComplete(env.db)).toBe(false)
})
