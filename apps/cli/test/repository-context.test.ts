import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import type { RepositoryContextReport } from '@bazilion/api-types'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { extractAgentId } from './helpers.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

let server: TestServer
const capturedPrompts: string[] = []
const fake = createServer(async (request, response) => {
  try {
    let input = ''
    for await (const chunk of request) input += chunk
    const body = JSON.parse(input) as {
      messages: Array<{ role: string; content?: unknown }>
      tools: Array<{ function: { name: string } }>
    }
    capturedPrompts.push(
      JSON.stringify(
        body.messages.filter(
          (message) => message.role === 'system' || message.role === 'developer',
        ),
      ),
    )
    if (!body.tools.some((tool) => tool.function.name === 'repository_context'))
      throw new Error('Missing repository tool')
    const first = capturedPrompts.length === 1
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const chunk = (delta: unknown, finish: string | null = null) =>
      response.write(
        `data: ${JSON.stringify({ id: 'context-provider', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
      )
    chunk({ role: 'assistant' })
    if (first)
      chunk({
        tool_calls: [
          {
            index: 0,
            id: 'context-call',
            type: 'function',
            function: {
              name: 'repository_context',
              arguments: JSON.stringify({ target: 'app/new.ts' }),
            },
          },
        ],
      })
    else chunk({ content: 'CONTEXT_ROUND_TRIP_COMPLETE' })
    chunk({}, first ? 'tool_calls' : 'stop')
    response.end('data: [DONE]\n\n')
  } catch {
    response.writeHead(500)
    response.end('Fixture rejected request')
  }
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

test('authenticated API and CLI expose matching scoped context and refresh with no project mutation', async () => {
  const root = join(server.home, 'teams', 'default')
  mkdirSync(join(root, 'app'))
  writeFileSync(join(root, 'AGENTS.md'), 'ROOT INSTRUCTIONS\n')
  writeFileSync(join(root, 'app', 'AGENTS.md'), 'NESTED INSTRUCTIONS\n')
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ packageManager: 'pnpm@10.0.0', scripts: { test: 'echo TEST' } }),
  )
  const url = `${server.url}/api/teams/default/repository-context?target=app/new.ts`
  expect((await fetch(url)).status).toBe(401)
  const response = await fetch(url, { headers: { authorization: `Bearer ${server.token}` } })
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const api = (await response.json()) as RepositoryContextReport
  const cli = await server.cli(['team', 'context', 'default', '--target', 'app/new.ts', '--json'])
  expect(cli.exitCode).toBe(0)
  const report = JSON.parse(cli.stdout) as RepositoryContextReport
  expect(report.fingerprint).toBe(api.fingerprint)
  expect(report.instructions.files.map((file) => file.content)).toEqual([
    'ROOT INSTRUCTIONS\n',
    'NESTED INSTRUCTIONS\n',
  ])
  expect(report.commands.candidates[0]?.packageManager).toBe('pnpm')
  expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe('ROOT INSTRUCTIONS\n')
  const readable = await server.cli(['team', 'context', 'default'])
  expect(readable.exitCode).toBe(0)
  expect(readable.stdout).toContain('Repository instructions: complete')
  expect(readable.stdout).toContain('not executed')
  writeFileSync(join(root, 'AGENTS.md'), 'UPDATED\n')
  const refreshed = await server.cli(['team', 'context', 'default', '--json'])
  expect(JSON.parse(refreshed.stdout).instructions.files[0].content).toBe('UPDATED\n')
  const unavailable = await server.cli([
    'team',
    'context',
    'default',
    '--target',
    '../outside',
    '--json',
  ])
  expect(JSON.parse(unavailable.stdout).instructions.state).toBe('incomplete')
  expect((await server.cli(['team', 'context', 'missing'])).exitCode).not.toBe(0)
})

test('actual configured worker receives root instructions and refreshes nested context through daemon IPC', async () => {
  const root = join(server.home, 'teams', 'default')
  writeFileSync(join(root, 'AGENTS.md'), 'INITIAL_PROVIDER_CONTEXT_SENTINEL\n')
  writeFileSync(join(root, 'app', 'AGENTS.md'), 'NESTED_PROVIDER_CONTEXT_SENTINEL\n')
  expect(
    (await server.cli(['profile', 'create', 'coder', '--model', 'lmstudio:test-model'])).exitCode,
  ).toBe(0)
  const spawned = await server.cli(['agent', 'spawn', '--profile', 'coder'])
  const agentId = extractAgentId(spawned.stdout)
  const result = await server.cli(['agent', 'chat', agentId, '--message', 'inspect nested context'])
  expect(result.exitCode).toBe(0)
  expect(result.stdout).toContain('CONTEXT_ROUND_TRIP_COMPLETE')
  expect(capturedPrompts).toHaveLength(2)
  expect(capturedPrompts[0]).toContain('INITIAL_PROVIDER_CONTEXT_SENTINEL')
  expect(capturedPrompts[0]).not.toContain('NESTED_PROVIDER_CONTEXT_SENTINEL')
  expect(capturedPrompts[1]).toContain('NESTED_PROVIDER_CONTEXT_SENTINEL')
  const history = await fetch(`${server.url}/api/agents/${agentId}/sessions/messages`, {
    headers: { authorization: `Bearer ${server.token}` },
  })
  expect(await history.text()).not.toContain('NESTED_PROVIDER_CONTEXT_SENTINEL')
  writeFileSync(join(root, 'AGENTS.md'), 'x'.repeat(64 * 1024 + 1))
  const blocked = await server.cli([
    'agent',
    'chat',
    agentId,
    '--message',
    'must not reach provider',
  ])
  expect(blocked.exitCode).not.toBe(0)
  expect(capturedPrompts).toHaveLength(2)
})
