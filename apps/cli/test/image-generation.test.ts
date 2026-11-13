import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { type MockLlm, startLmStudioMock } from './fixtures/mock-lmstudio.ts'
import { extractAgentId } from './helpers.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const directory = mkdtempSync(join(tmpdir(), 'baz-images-'))
let mock: MockLlm
let server: TestServer

beforeAll(async () => {
  mock = await startLmStudioMock()
  server = await startTestServer({
    LMSTUDIO_URL: mock.url,
    OPENAI_API_KEY: 'fixture-openai-key',
    // fixtures/image-fetch.mjs answers the image provider inside the daemon.
    BAZILION_IMAGE_TEST_CALLS: join(directory, 'provider-calls.jsonl'),
    NODE_OPTIONS: `--import=${new URL('./fixtures/image-fetch.mjs', import.meta.url).href}`,
    BAZILION_IMAGE_MODEL: undefined,
    BAZILION_BASH_SANDBOX: 'off',
    BAZILION_SCHEDULER: 'off',
  })
})
afterAll(async () => {
  await server?.stop()
  await mock?.stop()
  rmSync(directory, { recursive: true, force: true })
})

/** One canned turn: the model calls image_generate once, then finishes. */
function imageTurn(name: string): void {
  mock.push([
    {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: `call-${name}`,
                type: 'function',
                function: {
                  name: 'image_generate',
                  arguments: JSON.stringify({ prompt: `Illustration ${name}`, name }),
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    },
    { choices: [{ message: { role: 'assistant', content: 'IMAGE_TURN_COMPLETE' } }] },
  ])
}

/** `agent chat` run in `directory`, where the CLI saves the files a turn delivers. */
async function chat(agentId: string, message: string): Promise<string> {
  const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url))
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      '--import',
      import.meta.resolve('tsx/esm'),
      entry,
      'agent',
      'chat',
      agentId,
      '--message',
      message,
    ],
    {
      cwd: directory,
      env: {
        ...process.env,
        BAZILION_HOME: server.home,
        BAZILION_SERVER: server.url,
        BAZILION_TOKEN: server.token,
      },
    },
  )
  expect(stdout).toContain('IMAGE_TURN_COMPLETE')
  expect(stdout).not.toContain('tool error')
  expect(stdout).not.toContain('fixture-openai-key')
  return stdout
}

test('an image from a CLI turn is saved in the working directory, never over a file', async () => {
  const cli = async (args: string[]) => {
    const result = await server.cli(args)
    expect(result.exitCode, result.stderr || result.stdout).toBe(0)
    return result.stdout
  }
  await cli(['config', 'set', 'BAZILION_IMAGE_MODEL', 'openai:gpt-image-2'])
  await cli(['profile', 'create', 'illustrator', '--model', 'lmstudio:test-model'])
  const agentId = extractAgentId(await cli(['agent', 'spawn', '--profile', 'illustrator']))

  // A file of the same name stays untouched; the image remains a saved result.
  writeFileSync(join(directory, 'first.png'), 'existing operator file')
  imageTurn('first')
  const first = await chat(agentId, 'Make an illustration.')
  expect(readFileSync(join(directory, 'first.png'), 'utf8')).toBe('existing operator file')
  const resultId = first.match(/already exists; saved as result ([\w-]+)/)?.[1]
  expect(resultId, first).toBeDefined()

  imageTurn('second')
  expect(await chat(agentId, 'Rework it.')).toContain('[file received: saved to ./second.png')
  const saved = readFileSync(join(directory, 'second.png'))
  expect(saved.subarray(0, 8)).toEqual(PNG_SIGNATURE)

  await cli(['result', 'download', resultId ?? '', '--output', join(directory, 'download.png')])
  expect(readFileSync(join(directory, 'download.png'))).toEqual(saved)
}, 60_000)
