// An Agent's secrets end to end (BAZ-090): stored from the CLI, in a real turn's commands by name,
// out of what the model reads back and out of the transcript; a secret_request card is answered
// by storing the secret.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  type CannedResponse,
  type MockLlm,
  sseFromCanned,
  startLmStudioMock,
  toolCall,
} from './fixtures/mock-lmstudio.ts'
import { extractAgentId } from './helpers.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

const VALUE = 'ghp_cli_value_123456'
let mock: MockLlm
let server: TestServer
let agent: string

beforeAll(async () => {
  mock = await startLmStudioMock()
  server = await startTestServer({
    LMSTUDIO_URL: mock.url,
    BAZILION_SCHEDULER: 'off',
    BAZILION_BASH_SANDBOX: 'off',
    BAZILION_BASH_APPROVAL: 'off',
    TELEGRAM_BOT_TOKEN: '',
  })
  await server.cli(['profile', 'create', 'keys', '--model', 'lmstudio:test-model'])
  agent = extractAgentId((await server.cli(['agent', 'spawn', '--profile', 'keys'])).stdout)
})

afterAll(async () => {
  await server?.stop()
  await mock?.stop()
})

/** Answer the next model request with `reply`, keeping the request body. */
function capture(into: string[], reply: CannedResponse) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    let body = ''
    for await (const chunk of req) body += String(chunk)
    into.push(body)
    sseFromCanned(res, reply)
  }
}

const done = (text: string): CannedResponse => ({
  choices: [{ message: { role: 'assistant', content: text } }],
})

test('a stored secret is in the commands by name, and the model and transcript never get it', async () => {
  const file = join(server.home, '..', 'token.txt')
  writeFileSync(file, VALUE)
  const set = await server.cli([
    'agent',
    'secret',
    'set',
    agent,
    'GITHUB_TOKEN',
    '--from-file',
    file,
    '--hosts',
    'api.github.com',
    '--reason',
    'Open pull requests',
  ])
  expect(set.exitCode, set.stderr).toBe(0)
  expect(set.stdout).toContain('stored GITHUB_TOKEN (web_fetch: api.github.com)')
  const list = await server.cli(['agent', 'secret', 'list', agent])
  expect(list.stdout).toContain('GITHUB_TOKEN')
  expect(list.stdout).toContain('web_fetch: api.github.com')
  expect(list.stdout).not.toContain(VALUE)

  const requests: string[] = []
  mock.push([
    capture(
      requests,
      toolCall('bash', {
        // Checks it by length, so the model's own call does not hold the value.
        command: `printf 'token=%s\\n' "$GITHUB_TOKEN"; test "\${#GITHUB_TOKEN}" = ${VALUE.length} && echo MATCHES`,
        timeout: 10,
      }),
    ),
    capture(requests, done('SECRET_DONE')),
  ])
  const chat = await server.cli(['agent', 'chat', agent, '--message', 'Check the token.'])
  expect(chat.exitCode, chat.stderr).toBe(0)
  expect(chat.stdout).toContain('SECRET_DONE')
  // The system prompt names it; the command had it; the model reads it back redacted.
  expect(requests[0]).toContain('# Secrets')
  expect(requests[0]).toContain('GITHUB_TOKEN: web_fetch for api.github.com')
  expect(requests[1]).toContain('MATCHES')
  expect(requests[1]).toContain('token=[REDACTED]')
  for (const body of requests) expect(body).not.toContain(VALUE)
  const sessions = join(server.home, 'agents', agent, 'sessions')
  for (const name of readdirSync(sessions))
    expect(readFileSync(join(sessions, name), 'utf8')).not.toContain(VALUE)
  expect(chat.stdout).not.toContain(VALUE)

  // A turn's own message is cleaned too: a wake carrying a background job's output takes this path.
  const said: string[] = []
  mock.push([capture(said, done('NOTED'))])
  const echoed = await server.cli(['agent', 'chat', agent, '--message', `The job printed ${VALUE}`])
  expect(echoed.exitCode, echoed.stderr).toBe(0)
  expect(said[0]).toContain('The job printed [REDACTED]')
  expect(said[0]).not.toContain(VALUE)

  const rm = await server.cli(['agent', 'secret', 'rm', agent, 'GITHUB_TOKEN'])
  expect(rm.exitCode, rm.stderr).toBe(0)
  expect((await server.cli(['agent', 'secret', 'list', agent])).stdout).toContain('(no secrets)')
})

test('secret_request shows a card, and storing the secret answers it', async () => {
  const requests: string[] = []
  mock.push([
    capture(
      requests,
      toolCall('secret_request', {
        name: 'SENTRY_TOKEN',
        reason: 'Read the latest errors',
        hosts: ['sentry.io'],
      }),
    ),
    capture(requests, done('ASKED_FOR_IT')),
  ])
  // A turn whose owner can answer, as the web chat starts it.
  const response = await fetch(`${server.url}/api/agents/${agent}/chat`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${server.token}`,
      'content-type': 'application/json',
      origin: server.url,
    },
    body: JSON.stringify({ message: 'Look at the errors.', questionMode: 'web' }),
  })
  expect(response.status).toBe(200)
  const stream = await response.text()
  const asked = stream
    .split('\n')
    .filter((line) => line.trim())
    .map(
      (line) => JSON.parse(line) as { kind: string; event?: { type: string; question?: unknown } },
    )
    .filter((frame) => frame.kind === 'event' && frame.event?.type === 'agent_question')
  expect(asked).toEqual([
    expect.objectContaining({
      event: expect.objectContaining({
        question: expect.objectContaining({
          question: {
            secret: {
              name: 'SENTRY_TOKEN',
              reason: 'Read the latest errors',
              hosts: ['sentry.io'],
            },
          },
        }),
      }),
    }),
  ])
  const toolMessages = (
    JSON.parse(requests[1] ?? '{}') as { messages: Array<{ role: string; content: unknown }> }
  ).messages.filter((m) => m.role === 'tool')
  expect(JSON.stringify(toolMessages.at(-1))).toContain('Asked the user for SENTRY_TOKEN')

  const waiting = await server.cli(['question', 'list', agent])
  expect(waiting.stdout).toContain('a secret request')
  expect(waiting.stdout).toContain('Asks for a secret: SENTRY_TOKEN')

  const file = join(server.home, '..', 'sentry.txt')
  writeFileSync(file, 'sntrys_value_abcdef')
  const set = await server.cli([
    'agent',
    'secret',
    'set',
    agent,
    'SENTRY_TOKEN',
    '--from-file',
    file,
  ])
  expect(set.exitCode, set.stderr).toBe(0)
  // The card's reason comes with it; its hosts only when given here.
  expect(set.stdout).toContain(
    'The Agent asked that web_fetch may send SENTRY_TOKEN to sentry.io. That is not given unless you pass --hosts sentry.io.',
  )
  expect(set.stdout).toMatch(/stored SENTRY_TOKEN\n/)
  expect((await server.cli(['question', 'list', agent])).stdout).toContain('(no waiting questions)')
  const list = await server.cli(['agent', 'secret', 'list', agent])
  expect(list.stdout).toContain('Read the latest errors')
})
