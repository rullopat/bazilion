import { mkdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { extractAgentId } from './helpers.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

let server: TestServer
const capturedPrompts: string[] = []
const fake = createServer(async (request, response) => {
  let input = ''
  for await (const chunk of request) input += chunk
  const body = JSON.parse(input) as { messages: Array<{ role: string }> }
  capturedPrompts.push(
    JSON.stringify(
      body.messages.filter((message) => message.role === 'system' || message.role === 'developer'),
    ),
  )
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  const chunk = (delta: unknown, finish: string | null = null) =>
    response.write(
      `data: ${JSON.stringify({ id: 'context-provider', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
    )
  chunk({ role: 'assistant' })
  chunk({ content: 'INSTRUCTIONS_TURN_COMPLETE' })
  chunk({}, 'stop')
  response.end('data: [DONE]\n\n')
})
beforeAll(async () => {
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve))
  const address = fake.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  server = await startTestServer({
    LMSTUDIO_URL: `http://127.0.0.1:${address.port}/v1`,
    BAZILION_SCHEDULER: 'off',
    BAZILION_PUBLIC_ORIGIN: '',
    BAZILION_BASH_SANDBOX: 'off',
    TELEGRAM_BOT_TOKEN: '',
  })
})
afterAll(async () => {
  await server?.stop()
  await new Promise<void>((resolve) => fake.close(() => resolve()))
})

test('the worker receives the workspace AGENTS.md, and an unusable one never blocks a turn', async () => {
  const root = join(server.home, 'teams', 'default')
  mkdirSync(join(root, 'app'))
  writeFileSync(join(root, 'AGENTS.md'), 'ROOT_PROVIDER_CONTEXT_SENTINEL\n')
  writeFileSync(join(root, 'app', 'AGENTS.md'), 'NESTED_PROVIDER_CONTEXT_SENTINEL\n')
  expect(
    (await server.cli(['profile', 'create', 'coder', '--model', 'lmstudio:test-model'])).exitCode,
  ).toBe(0)
  const agentId = extractAgentId(
    (await server.cli(['agent', 'spawn', '--profile', 'coder'])).stdout,
  )
  const chat = (message: string) => server.cli(['agent', 'chat', agentId, '--message', message])

  const first = await chat('read the instructions')
  expect(first.exitCode, first.stderr).toBe(0)
  expect(first.stdout).toContain('INSTRUCTIONS_TURN_COMPLETE')
  expect(capturedPrompts[0]).toContain('ROOT_PROVIDER_CONTEXT_SENTINEL')
  expect(capturedPrompts[0]).toContain('govern its own directory and everything below it')
  // Nested instructions are the agent's to read when its work reaches that directory.
  expect(capturedPrompts[0]).not.toContain('NESTED_PROVIDER_CONTEXT_SENTINEL')

  // A link to a file outside the workspace is skipped, and the turn still runs.
  writeFileSync(join(server.home, 'outside.md'), 'OUTSIDE_SENTINEL\n')
  unlinkSync(join(root, 'AGENTS.md'))
  symlinkSync(join(server.home, 'outside.md'), join(root, 'AGENTS.md'))
  const second = await chat('still works')
  expect(second.exitCode, second.stderr).toBe(0)
  expect(capturedPrompts[1]).not.toContain('OUTSIDE_SENTINEL')
})
