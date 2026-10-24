import { symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { openDb, resolveAgent, resolvePaths } from '../../daemon/src/core/index.ts'
import { type MockLlm, startLmStudioMock } from './fixtures/mock-lmstudio.ts'
import { extractAgentId } from './helpers.ts'
import { startTestServer, stopSettledTestServer, type TestServer } from './server-fixture.ts'

let mock: MockLlm | undefined
let server: TestServer | undefined
let agentId: string
let teamDir: string

beforeEach(async () => {
  mock = await startLmStudioMock()
  server = await startTestServer({
    LMSTUDIO_URL: mock.url,
    LMSTUDIO_API_KEY: 'synthetic-local-fixture',
    // Leave the env override absent so the second test's daemon-owned config selects Docker.
    BAZILION_BASH_SANDBOX: undefined,
    BAZILION_SCHEDULER: 'off',
    DOCKER_HOST: 'unix:///bazilion-nonexistent-fixture/socket',
    DOCKER_CONTEXT: '',
  })
  const created = await server.cli(['profile', 'create', 'p', '--model', 'lmstudio:test-model'])
  expect(created.exitCode, created.stderr).toBe(0)
  const spawned = await server.cli(['agent', 'spawn', '--profile', 'p'])
  expect(spawned.exitCode, spawned.stderr).toBe(0)
  agentId = extractAgentId(spawned.stdout)
  const paths = resolvePaths(server.home)
  const db = openDb(paths.db)
  try {
    teamDir = resolveAgent(db, paths, agentId).team.path
  } finally {
    db.close()
  }
}, 30_000)

afterEach(async () => {
  try {
    if (server) await stopSettledTestServer(server)
  } finally {
    server = undefined
    if (mock) await mock.stop()
    mock = undefined
  }
})

async function chat() {
  if (!server) throw new Error('missing fixture')
  return fetch(`${server.url}/api/agents/${agentId}/chat`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${server.token}`,
      origin: server.url,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      message: 'Do not start a model turn.',
      expectedSelection: { conversationId: null, revision: 0 },
    }),
  })
}

test('an unsafe repository-context input reports the actual refusal, not a Linux-only claim', async () => {
  if (!server || !mock) throw new Error('missing fixture')
  const outside = join(server.home, 'outside-fixture.md')
  writeFileSync(outside, 'SYNTHETIC_OUTSIDE_INSTRUCTION_MUST_NOT_BE_READ')
  symlinkSync(outside, join(teamDir, 'AGENTS.md'))
  const response = await chat()
  expect(response.status).toBe(422)
  const body = (await response.json()) as { code: string; error: string }
  expect(body.code).toBe('unsafe_file')
  expect(body.error).toContain('repository context')
  expect(body.error).not.toContain('require Linux')
  expect(body.error).not.toContain('SYNTHETIC_OUTSIDE_INSTRUCTION')
  expect(mock.callCount()).toBe(0)
})

test('missing protected Docker prerequisites return the closed refusal before provider use, never HTTP 500 or host execution', async () => {
  if (!server || !mock) throw new Error('missing fixture')
  const configured = await server.cli(['config', 'set', 'BAZILION_BASH_SANDBOX', 'docker'])
  expect(configured.exitCode, configured.stderr).toBe(0)
  const response = await chat()
  expect(response.status).toBe(409)
  const body = await response.json()
  expect(body).toEqual({
    code: 'protected_execution_unavailable',
    error: 'Protected Docker runtime is unavailable. Run `bazilion doctor` for remediation.',
  })
  expect(JSON.stringify(body)).not.toContain('synthetic-local-fixture')
  expect(mock.callCount()).toBe(0)
})
