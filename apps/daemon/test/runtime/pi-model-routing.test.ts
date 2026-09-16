import { expect, test } from 'vitest'
import {
  createBazilionPiRuntime,
  providerBaseUrl,
  resolvePiModel,
  UnknownModelError,
} from '../../src/runtime/providers/pi-runtime.ts'

// Model resolution must fail closed.
//
// An id missing from the provider's catalog used to fall back to a model with
// `baseUrl: ''`, which resolves to a provider default further down the stack
// while still carrying the configured provider's credential. A typo in a model
// string therefore sent, for example, a Fireworks key to OpenAI. These tests pin
// the refusal and the endpoint catalogued models actually carry.

const FIREWORKS_CATALOG_ID = 'accounts/fireworks/models/deepseek-v4-flash-0731'

test('an uncatalogued model id with no endpoint is refused instead of misrouted', async () => {
  const runtime = await createBazilionPiRuntime({ providerName: 'fireworks', env: {} })
  expect(() => resolvePiModel(runtime, 'fireworks', 'deepseek-flash-latest')).toThrow(
    UnknownModelError,
  )
  expect(() => resolvePiModel(runtime, 'fireworks', 'deepseek-flash-latest')).toThrow(
    /Unknown model "deepseek-flash-latest" for provider "fireworks"/,
  )
  // An explicitly empty base URL is just as unsafe as an absent one.
  expect(() => resolvePiModel(runtime, 'fireworks', 'deepseek-flash-latest', '')).toThrow(
    UnknownModelError,
  )
})

test('a catalogued model resolves to its own provider endpoint', async () => {
  const runtime = await createBazilionPiRuntime({ providerName: 'fireworks', env: {} })
  const model = resolvePiModel(runtime, 'fireworks', FIREWORKS_CATALOG_ID)
  expect(model.provider).toBe('fireworks')
  expect(model.baseUrl).toContain('api.fireworks.ai')
  expect(model.baseUrl).not.toContain('openai.com')
})

test('a configured endpoint still admits an uncatalogued model', async () => {
  const runtime = await createBazilionPiRuntime({
    providerName: 'lmstudio',
    env: { LMSTUDIO_URL: 'http://127.0.0.1:9999/v1' },
  })
  const model = resolvePiModel(
    runtime,
    'lmstudio',
    'some-locally-loaded-model',
    providerBaseUrl('lmstudio', { LMSTUDIO_URL: 'http://127.0.0.1:9999/v1' }),
  )
  expect(model.baseUrl).toBe('http://127.0.0.1:9999/v1')
  expect(model.provider).toBe('lmstudio')

  // The local providers always publish a base URL, so they keep working with
  // arbitrary user-loaded model names.
  expect(providerBaseUrl('ollama', {})).toContain('11434')
  expect(providerBaseUrl('llamacpp', {})).toContain('8080')
})

test('an explicit base URL override wins for an uncatalogued model', async () => {
  const runtime = await createBazilionPiRuntime({
    providerName: 'lmstudio',
    env: {},
  })
  const model = resolvePiModel(runtime, 'lmstudio', 'custom', 'http://127.0.0.1:1234/v1')
  expect(model.baseUrl).toBe('http://127.0.0.1:1234/v1')
})

test('fireworks has its own endpoint, so a model newer than the catalog stays on Fireworks', async () => {
  // The fail-closed rule exists to stop an uncatalogued id reaching *another vendor's* default with this
  // provider's credential. Fireworks publishes one inference endpoint for everything it hosts, so pinning
  // it keeps that intent while letting an upstream model (here the 4.1 flash, absent from this build's
  // catalog) be used without waiting for a catalog update.
  const endpoint = providerBaseUrl('fireworks', {})
  expect(endpoint).toContain('api.fireworks.ai')
  expect(endpoint).not.toContain('openai.com')

  const runtime = await createBazilionPiRuntime({ providerName: 'fireworks', env: {} })
  const model = resolvePiModel(
    runtime,
    'fireworks',
    'accounts/fireworks/models/deepseek-v4p1-flash',
    endpoint,
  )
  expect(model.provider).toBe('fireworks')
  expect(model.baseUrl).toContain('api.fireworks.ai')

  // An operator can still point Fireworks at a proxy, explicitly, which is the remedy the unknown-model
  // error names — but it has to be stated rather than inherited.
  expect(providerBaseUrl('fireworks', { FIREWORKS_BASE_URL: 'https://proxy.internal/v1' })).toBe(
    'https://proxy.internal/v1',
  )
  // An unknown provider still has no endpoint, so its uncatalogued ids are still refused.
  expect(providerBaseUrl('fireworks-not-a-provider', {})).toBeUndefined()
})
