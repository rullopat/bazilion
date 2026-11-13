import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createApp } from '../../src/app.ts'
import { createProfile, providerStateRepo, spawnAgent, webTokenRepo } from '../../src/core/index.ts'
import * as providerModels from '../../src/core/repos/providerModels.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
let token: string
let agentId: string
const spawnWorkerTurn = vi.hoisted(() => vi.fn())
vi.mock('../../src/lib/ctx.ts', () => ({
  getCtx: () => ({ db: env.db, paths: env.paths, authToken: token }),
}))
vi.mock('../../src/runtime/index.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/runtime/index.ts')>()),
  spawnWorkerTurn,
}))

beforeEach(() => {
  env = makeTestEnv()
  token = webTokenRepo.create(env.db, 'test', { kind: 'bootstrap' }).token
  for (const provider of ['lmstudio', 'ollama']) {
    providerStateRepo.setEnabled(env.db, provider, true)
    providerModels.replace(env.db, provider, ['test'])
  }
  createProfile(env.db, env.paths, { id: 'test', defaultModel: 'lmstudio:test' })
  agentId = spawnAgent(env.db, env.paths, { profileId: 'test', teamId: env.teamId }).id
})
afterEach(() => env.cleanup())

test('a chat whose provider is disabled is refused with 409 before any worker starts', async () => {
  // Ollama keeps first-run setup complete, so the refusal comes from the chat route itself.
  providerStateRepo.setEnabled(env.db, 'lmstudio', false)
  const response = await createApp().request(`/api/agents/${agentId}/chat`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'hello' }),
  })
  expect(response.status).toBe(409)
  expect(await response.json()).toEqual({
    error: 'lmstudio provider is disabled — enable it on the /config page',
  })
  expect(spawnWorkerTurn).not.toHaveBeenCalled()
})
