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
