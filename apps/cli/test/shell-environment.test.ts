// A real Agent turn runs `env` with host bash: provider keys are there, Bazilion's own
// credentials (ChatGPT OAuth blob, MCP bearer tokens, the CLI bearer) are not.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { openDb } from '../../daemon/src/core/db/client.ts'
import { openSecrets } from '../../daemon/src/core/index.ts'
import {
  type CannedResponse,
  type MockLlm,
  sseFromCanned,
  startLmStudioMock,
} from './fixtures/mock-lmstudio.ts'
import { extractAgentId } from './helpers.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

let mock: MockLlm
let server: TestServer

beforeAll(async () => {
  mock = await startLmStudioMock()
  server = await startTestServer({
    LMSTUDIO_URL: mock.url,
    BAZILION_SCHEDULER: 'off',
    BAZILION_BASH_SANDBOX: 'off',
    BAZILION_BASH_APPROVAL: 'off',
    TELEGRAM_BOT_TOKEN: '',
    OPENAI_API_KEY: 'provider-key-in-daemon-env',
    BAZILION_TOKEN: 'cli-bearer-in-daemon-env',
  })
})

afterAll(async () => {
  await server?.stop()
  await mock?.stop()
})

function bash(command: string): CannedResponse {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call-env',
              type: 'function',
              function: { name: 'bash', arguments: JSON.stringify({ command, timeout: 10 }) },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
  }
}

test('host bash never sees Bazilion’s own credentials', async () => {
  const db = openDb(join(server.home, 'bazilion.db'))
  try {
    const secrets = openSecrets(db, server.token)
    secrets.set('OPENAI_CODEX_OAUTH', '{"refresh":"refresh-blob","access":"a","expires":1}')
    secrets.set('MCP_TOKEN_0123ABCD', 'mcp-bearer-secret')
  } finally {
    db.close()
  }
  let toolResult = ''
  mock.push([
    bash('env'),
    async (req: IncomingMessage, res: ServerResponse) => {
      for await (const chunk of req) toolResult += String(chunk)
      sseFromCanned(res, { choices: [{ message: { role: 'assistant', content: 'ENV_DONE' } }] })
    },
  ])
  expect(
    (await server.cli(['profile', 'create', 'shell', '--model', 'lmstudio:test-model'])).exitCode,
  ).toBe(0)
  const agent = extractAgentId((await server.cli(['agent', 'spawn', '--profile', 'shell'])).stdout)
  const chat = await server.cli(['agent', 'chat', agent, '--message', 'Print the environment.'])
  expect(chat.exitCode, chat.stderr).toBe(0)
  expect(chat.stdout).toContain('ENV_DONE')

  // The second model request carries the `env` output as the tool result.
  expect(toolResult).toContain('OPENAI_API_KEY=')
  for (const internal of [
    'OPENAI_CODEX_OAUTH=',
    'refresh-blob',
    'MCP_TOKEN_',
    'mcp-bearer-secret',
    'BAZILION_TOKEN=',
    'cli-bearer-in-daemon-env',
    server.token,
  ])
    expect(toolResult).not.toContain(internal)
})
