import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ListJobsResponse } from '@bazilion/api-types'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { spawnAgent } from '../../daemon/src/core/agent/spawn.ts'
import { openDb } from '../../daemon/src/core/db/client.ts'
import { resolvePaths } from '../../daemon/src/core/paths.ts'
import { createProfile } from '../../daemon/src/core/profile/create.ts'
import {
  type MockLlm,
  reply,
  sseFromCanned,
  startLmStudioMock,
  toolCall,
} from './fixtures/mock-lmstudio.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

let server: TestServer
let mock: MockLlm
beforeAll(async () => {
  mock = await startLmStudioMock()
  server = await startTestServer({ LMSTUDIO_URL: mock.url, BAZILION_SCHEDULER_TICK_MS: '250' })
})
afterAll(async () => {
  await server.stop()
  await mock.stop()
})

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => resolve(body))
  })
}

// The whole path: the model starts a job with bash, the daemon keeps it past the turn, and its
// end wakes the Agent in the same conversation with what it printed.
test('a background job outlives its turn, and its end wakes the Agent', async () => {
  const paths = resolvePaths(server.home)
  const db = openDb(paths.db)
  let agentId: string
  try {
    createProfile(db, paths, { id: 'builder', defaultModel: 'lmstudio:test-model' })
    agentId = spawnAgent(db, paths, { profileId: 'builder' }).id
  } finally {
    db.close()
  }
  let wakeRequest = ''
  mock.push([
    toolCall('bash', {
      command: 'echo started; sleep 1; echo finished building',
      background: true,
    }),
    reply('STARTED'),
    async (req: IncomingMessage, res: ServerResponse) => {
      wakeRequest = await readBody(req)
      sseFromCanned(res, reply('THE BUILD IS DONE'))
    },
  ])
  const queued = await server.cli(['queue', 'add', agentId, '--message', 'Start the build.'])
  expect(queued.exitCode, queued.stderr).toBe(0)

  const job = await vi.waitFor(
    async () => {
      const response = await fetch(`${server.url}/api/agents/${agentId}/jobs`, {
        headers: { authorization: `Bearer ${server.token}` },
      })
      const [first] = ((await response.json()) as ListJobsResponse).jobs
      expect(first?.status).toBe('exited')
      return first
    },
    { timeout: 60_000, interval: 250 },
  )
  expect(job).toMatchObject({
    exitCode: 0,
    sandbox: 'host',
    command: expect.stringContaining('echo started'),
  })
  const shown = await server.cli(['job', 'show', job?.id ?? ''])
  expect(shown.exitCode, shown.stderr).toBe(0)
  expect(shown.stdout).toContain('finished building')
  expect((await server.cli(['job', 'list', agentId])).stdout).toContain('exit 0')

  await vi.waitFor(() => expect(wakeRequest).toContain('finished building'), {
    timeout: 60_000,
    interval: 250,
  })
  expect(wakeRequest).toContain(`Background job ${job?.id} ended with exit code 0`)
}, 120_000)
