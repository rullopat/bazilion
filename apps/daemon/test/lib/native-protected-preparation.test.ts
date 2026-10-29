import { createServer } from 'node:http'
import { expect, test } from 'vitest'
import {
  createProfile,
  openConfig,
  openSecrets,
  providerStateRepo,
  resolveAgent,
  spawnAgent,
} from '../../src/core/index.ts'
import { workspaceLifecycle } from '../../src/lib/coding-environment/lifecycle.ts'
import { prepareProtectedNativeExecution } from '../../src/lib/native-execution/protected.ts'
import { makeTestEnv } from '../core/helpers.ts'

test.each([
  'disabled',
  'credential',
  'endpoint',
] as const)('native protected provider %s gate refuses before native creation or network requests', async (fault) => {
  const env = makeTestEnv(),
    authToken = 'controlled-projection-test'
  let requests = 0
  const server = createServer((_request, response) => {
    requests++
    response.writeHead(503)
    response.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fixture listener unavailable')
  createProfile(env.db, env.paths, {
    id: 'native-provider-gate',
    defaultModel: 'lmstudio:controlled-model',
  })
  const agent = resolveAgent(
    env.db,
    env.paths,
    spawnAgent(env.db, env.paths, { profileId: 'native-provider-gate', teamId: env.teamId }).id,
  )
  providerStateRepo.setEnabled(env.db, 'lmstudio', fault !== 'disabled')
  openSecrets(env.db, authToken).set(
    'LMSTUDIO_API_KEY',
    fault === 'credential' ? ' ' : 'controlled-selected-key',
  )
  openConfig(env.db).set(
    'LMSTUDIO_URL',
    `http://127.0.0.1:${address.port}/v1${fault === 'endpoint' ? '#unsafe' : ''}`,
  )
  const lifecycle = workspaceLifecycle(env.db),
    lease = lifecycle.coordinator.claim(env.teamId, agent.team.path, 'agent')
  try {
    await expect(
      prepareProtectedNativeExecution({ db: env.db, paths: env.paths, authToken }, agent, {
        lease,
        controller: new AbortController(),
        turnId: 'provider-gate',
      }),
    ).rejects.toThrow(
      fault === 'disabled'
        ? 'not enabled'
        : fault === 'credential'
          ? 'explicit credential'
          : 'unsafe URL fields',
    )
    expect(requests).toBe(0)
    expect(env.db.raw.query('SELECT id FROM workspace_resources').all()).toEqual([])
    await lifecycle.release(lease)
    expect(env.db.raw.query('SELECT id FROM workspace_writers').all()).toEqual([])
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
    env.cleanup()
  }
})
