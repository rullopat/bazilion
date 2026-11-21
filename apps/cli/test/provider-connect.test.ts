import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { type MockLlm, reply, startLmStudioMock } from './fixtures/mock-lmstudio.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

// `bazilion provider connect` end to end on a home where nothing is set up yet: the same one
// call the web's "Connect and test" makes, against a model server that can be told to refuse.

let mock: MockLlm
let server: TestServer

beforeAll(async () => {
  mock = await startLmStudioMock()
  server = await startTestServer({}, { setupComplete: false })
})
afterAll(async () => {
  await server.stop()
  await mock.stop()
})

const rejectKey = (_req: IncomingMessage, res: ServerResponse) => {
  res.writeHead(401, { 'content-type': 'application/json' })
  res.end(
    JSON.stringify({ error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } }),
  )
}

test('connect tests before it saves, switches the provider on and finishes first-run setup', async () => {
  const empty = await server.cli(['provider', 'list'])
  expect(empty.stdout).toContain('no provider is set up')
  // Until a provider works, the rest of the product is closed.
  expect((await server.cli(['agent', 'list'])).exitCode).not.toBe(0)

  mock.setFallback(rejectKey)
  const refused = await server.cli([
    'provider',
    'connect',
    'lmstudio',
    '--url',
    mock.url,
    '--models',
    'qwen3-coder-30b',
  ])
  expect(refused.exitCode).toBe(1)
  expect(refused.stderr).toContain('LM Studio asked for a key it did not get')
  expect(refused.stderr).toContain('details: 401')
  expect(refused.stderr).toContain('Nothing was saved.')
  expect((await server.cli(['provider', 'list'])).stdout).toContain('no provider is set up')

  mock.setFallback(reply('ready'))
  const connected = await server.cli([
    'provider',
    'connect',
    'lmstudio',
    '--url',
    mock.url,
    '--models',
    'qwen3-coder-30b, gemma-3-12b',
  ])
  expect(connected.exitCode).toBe(0)
  expect(connected.stdout).toContain('lmstudio: connected')
  expect(connected.stdout).toMatch(/qwen3-coder-30b answered in \d+\.\d s/)
  expect(connected.stdout).toContain('models: qwen3-coder-30b, gemma-3-12b')

  const listed = await server.cli(['provider', 'list'])
  expect(listed.stdout).toMatch(/lmstudio\s+working\s+2 models\s+qwen3-coder-30b answered/)
  expect(listed.stdout).not.toContain('anthropic')
  expect((await server.cli(['provider', 'list', '--all'])).stdout).toMatch(/anthropic\s+not set up/)

  // Setup is complete: the default template and Team exist, on the first model.
  const spawned = await server.cli(['agent', 'spawn', '--profile', 'default'])
  expect(spawned.exitCode).toBe(0)
  expect((await server.cli(['profile', 'show', 'default'])).stdout).toContain(
    'lmstudio:qwen3-coder-30b',
  )
})

test('provider test remembers the outcome; a paused provider says so', async () => {
  const ok = await server.cli(['provider', 'test', 'lmstudio'])
  expect(ok.exitCode).toBe(0)
  expect(ok.stdout).toMatch(/lmstudio: qwen3-coder-30b answered in/)

  mock.setFallback(rejectKey)
  const failed = await server.cli(['provider', 'test', 'lmstudio'])
  expect(failed.exitCode).toBe(1)
  expect(failed.stderr).toContain('LM Studio asked for a key it did not get')
  expect((await server.cli(['provider', 'list'])).stdout).toMatch(/lmstudio\s+failing/)

  mock.setFallback(reply('ready'))
  await server.cli(['provider', 'test', 'lmstudio'])
  expect((await server.cli(['provider', 'disable', 'lmstudio'])).stdout).toContain('disabled')
  expect((await server.cli(['provider', 'list'])).stdout).toMatch(/lmstudio\s+off/)
  expect((await server.cli(['provider', 'enable', 'lmstudio'])).stdout).toContain('enabled')
})

test('a hosted provider connects with its suggested models; the key is never printed', async () => {
  const key = 'sk-ant-secret-0123456789'
  const connected = await server.cli([
    'provider',
    'connect',
    'anthropic',
    '--key',
    key,
    '--no-test',
  ])
  expect(connected.exitCode).toBe(0)
  expect(connected.stdout).toContain('anthropic: connected')
  expect(connected.stdout).toContain('not tested')
  expect(connected.stdout).toContain('models: claude-fable-5-2, claude-haiku-5-5')
  expect(connected.stdout + connected.stderr).not.toContain(key)
  expect((await server.cli(['provider', 'list'])).stdout).toMatch(
    /anthropic\s+not tested\s+2 models/,
  )

  const models = await server.cli(['provider', 'models', 'anthropic'])
  expect(models.stdout).toContain('## in use')
  expect(models.stdout).toMatch(/claude-fable-5-2\s+Claude Fable 5\.2\s+\d+K\s+\$[\d.]+ in/)
  expect(models.stdout).toContain('suggested')

  // No suggestions for this one: the models have to be named.
  const unnamed = await server.cli(['provider', 'connect', 'mistral', '--key', 'k', '--no-test'])
  expect(unnamed.exitCode).not.toBe(0)
  expect(unnamed.stderr).toContain('--models')
  // Switching on without credentials is refused, with the way out.
  const bare = await server.cli(['provider', 'enable', 'groq'])
  expect(bare.exitCode).not.toBe(0)
  expect(bare.stderr).toContain('bazilion provider connect groq')

  await server.cli(['provider', 'models-set', 'anthropic', 'claude-haiku-5-5'])
  expect((await server.cli(['provider', 'list'])).stdout).toMatch(
    /anthropic\s+not tested\s+1 model\s*$/m,
  )
})

test('disconnect removes the key and the models', async () => {
  const gone = await server.cli(['provider', 'disconnect', 'anthropic', '--yes'])
  expect(gone.exitCode).toBe(0)
  expect(gone.stdout).toContain('anthropic: disconnected')
  expect((await server.cli(['provider', 'list'])).stdout).not.toContain('anthropic')
  const fields = await server.cli(['config', 'list'])
  expect(fields.stdout).toMatch(/anthropic\s+ANTHROPIC_API_KEY\s+secret\s+\(unset\)/)
  // The image model is a model function: still a setting `config` knows.
  expect(fields.stdout).toMatch(/image-generation\s+BAZILION_IMAGE_MODEL/)
})
