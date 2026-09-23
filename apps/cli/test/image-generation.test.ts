import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { openDb } from '../../daemon/src/core/db/client.ts'
import { extractAgentId } from './helpers.ts'
import { restartTestServer, startTestServer, type TestServer } from './server-fixture.ts'

const directory = mkdtempSync(join(tmpdir(), 'baz059-agent-'))
const calls = join(directory, 'provider-calls.jsonl')
const errors: string[] = []
let server: TestServer
let daemonEnv: NodeJS.ProcessEnv
let toolEnabled = true
let turn = 0
let step = 0
const docker = process.env.BAZILION_TEST_DOCKER === '1'
const fake = createServer(async (request, response) => {
  try {
    let raw = ''
    for await (const bytes of request) raw += bytes
    const body = JSON.parse(raw)
    const names = body.tools.map((tool: { function: { name: string } }) => tool.function.name)
    if (names.includes('image_generate') !== toolEnabled)
      throw new Error('Image tool enablement disagrees with config')
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const currentStep = step++
    const containerProbe = docker && toolEnabled && currentStep === 0
    const delta =
      toolEnabled && (containerProbe || currentStep === (docker ? 1 : 0))
        ? {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: `${containerProbe ? 'container' : 'image'}-call-${turn}`,
                type: 'function',
                function: {
                  name: containerProbe ? 'coding_command' : 'image_generate',
                  arguments: JSON.stringify(
                    containerProbe
                      ? {
                          command:
                            'test "$PWD" = /workspace && test -z "$OPENAI_API_KEY$OPENROUTER_API_KEY" && printf isolated > image-container.txt',
                          cwd: '.',
                          purpose: 'test',
                          timeoutSeconds: 5,
                        }
                      : {
                          prompt: `Illustration version ${turn}`,
                          name: `version-${turn}`,
                        },
                  ),
                },
              },
            ],
          }
        : { role: 'assistant', content: 'IMAGE_TURN_COMPLETE' }
    response.end(
      `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: 'tool_calls' in delta ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
    )
  } catch (error) {
    errors.push(String(error))
    response.writeHead(500)
    response.end('fixture failed')
  }
})
beforeAll(async () => {
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve))
  const address = fake.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  daemonEnv = {
    LMSTUDIO_URL: `http://127.0.0.1:${address.port}/v1`,
    BAZILION_IMAGE_GENERATION: undefined,
    BAZILION_IMAGE_MODEL: undefined,
    OPENROUTER_API_KEY: 'fixture-image-key',
    OPENAI_API_KEY: 'fixture-openai-key',
    BAZILION_IMAGE_TEST_CALLS: calls,
    NODE_OPTIONS: `--import=${new URL('./fixtures/image-fetch.mjs', import.meta.url).href}`,
    BAZILION_BASH_SANDBOX: docker ? 'docker' : 'off',
    BAZILION_BASH_SANDBOX_IMAGE: process.env.BAZILION_TEST_DOCKER_IMAGE ?? 'debian:bookworm-slim',
    BAZILION_BASH_APPROVAL: 'off',
    BAZILION_SCHEDULER: 'off',
    BAZILION_PUBLIC_ORIGIN: '',
    TELEGRAM_BOT_TOKEN: '',
  }
  server = await startTestServer(daemonEnv)
})
afterAll(async () => {
  await server?.stop()
  await new Promise<void>((resolve) => fake.close(() => resolve()))
  rmSync(directory, { recursive: true, force: true })
})

// Six complete turns, configuration subprocesses and a daemon restart; bounded separately from
// single-turn tests. This is a functional journey, not a provider latency benchmark.
test('real one-shot Agent turns generate, rework and deliver saved images through IPC without a live provider', async () => {
  const cli = async (args: string[]) => {
    const result = await server.cli(args)
    expect(result.exitCode, result.stderr || result.stdout).toBe(0)
    return result.stdout
  }
  await cli(['profile', 'create', 'illustrator', '--model', 'lmstudio:test-model'])
  const agentId = extractAgentId(await cli(['agent', 'spawn', '--profile', 'illustrator']))
  expect(
    (
      await fetch(`${server.url}/api/auth/openai`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          access: 'fixture-codex-key',
          refresh: 'fixture-refresh-never-sent',
          expires: Date.now() + 3600000,
        }),
      })
    ).status,
  ).toBe(200)
  const selections = [
    'google/gemini-3.1-flash-image',
    'google/gemini-3.1-flash-image',
    'openai:gpt-image-2',
    'openai-codex:gpt-image-2',
    'auto',
    'auto',
  ]
  const resolvedSelections = [
    ...selections.slice(0, 4),
    'openai:gpt-image-2',
    'openai-codex:gpt-image-2',
  ]
  await cli(['config', 'set', 'BAZILION_IMAGE_MODEL', selections[0] as string])
  await cli(['config', 'set', 'BAZILION_IMAGE_GENERATION', 'on'])
  const execute = promisify(execFile)
  writeFileSync(join(directory, 'version-1.png'), 'existing operator file')
  for (turn = 1; turn <= selections.length; turn++) {
    if (turn === 5) {
      await cli(['provider', 'disable', 'openai-codex'])
      await cli(['provider', 'enable', 'openai'])
    }
    if (turn === 6) {
      await cli(['provider', 'disable', 'openai'])
      await cli(['provider', 'enable', 'openai-codex'])
    }
    await cli(['config', 'set', 'BAZILION_IMAGE_MODEL', selections[turn - 1] as string])
    step = 0
    const chat = await execute(
      process.execPath,
      [
        '--import',
        import.meta.resolve('tsx/esm'),
        fileURLToPath(new URL('../src/index.ts', import.meta.url)),
        'agent',
        'chat',
        agentId,
        '--message',
        turn === 1 ? 'Make an illustration.' : 'Rework the illustration.',
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
    expect(chat.stdout).toContain('IMAGE_TURN_COMPLETE')
    expect(chat.stdout + chat.stderr).not.toMatch(
      /fixture-(image|openai|codex)-key|fixture-refresh-never-sent/,
    )
    if (turn === 3 || turn === 5) expect(chat.stdout).toContain('OpenAI API key')
    if (turn === 4 || turn === 6) expect(chat.stdout).toContain('ChatGPT/Codex login')
    expect(chat.stdout).not.toContain('tool error')
    expect(chat.stdout).toContain(`version-${turn}.png`)
    if (turn === 1) {
      expect(chat.stdout).toContain('already exists and was left unchanged')
      expect(readFileSync(join(directory, 'version-1.png'), 'utf8')).toBe('existing operator file')
    } else {
      expect(readFileSync(join(directory, `version-${turn}.png`)).subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      )
    }
  }
  expect(errors).toEqual([])
  const capturedCalls = readFileSync(calls, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(capturedCalls.map((call) => call.route)).toEqual([
    'openrouter',
    'openrouter',
    'openai',
    'openai-codex',
    'openai',
    'openai-codex',
  ])
  expect(readFileSync(calls, 'utf8')).not.toContain('fixture-refresh-never-sent')
  let savedIds: string[] = []
  const db = openDb(join(server.home, 'bazilion.db'))
  try {
    if (docker) {
      expect(readFileSync(join(server.home, 'teams/default/image-container.txt'), 'utf8')).toBe(
        'isolated',
      )
      const receipts = db.raw
        .query<{ receipt_json: string }, []>('SELECT receipt_json FROM coding_commands')
        .all()
        .map((row) => JSON.parse(row.receipt_json))
      expect(receipts).toHaveLength(6)
      for (const receipt of receipts)
        expect(receipt).toMatchObject({ state: 'succeeded', environment: { posture: 'docker' } })
      const resources = db.raw
        .query<{ cleanup_confirmed: number; creation_acknowledged: number }, []>(
          'SELECT cleanup_confirmed, creation_acknowledged FROM workspace_resources',
        )
        .all()
      // Successful lease recovery deletes resource rows; these are not a retained execution log.
      expect(resources).toHaveLength(0)
    }
    const rows = db.raw
      .query<
        { id: string; session_id: string; released_at: number | null; image_model: string },
        []
      >('SELECT id, session_id, released_at, image_model FROM agent_results ORDER BY created_at')
      .all()
    expect(rows).toHaveLength(6)
    savedIds = rows.map((row) => row.id)
    expect(rows.every((row) => row.released_at !== null)).toBe(true)
    expect(rows.map((row) => row.image_model)).toEqual(resolvedSelections)
    expect(
      db.raw
        .query<{ n: number }, []>(
          "SELECT count(*) AS n FROM image_generations WHERE outcome = 'completed'",
        )
        .get()?.n,
    ).toBe(6)
    for (const row of rows) {
      const response = await fetch(`${server.url}/api/results/${row.id}/source`, {
        headers: { authorization: `Bearer ${server.token}` },
      })
      const source = (await response.json()) as {
        available: boolean
        messages: Array<{ results?: Array<{ resultId: string }> }>
      }
      expect(source.available).toBe(true)
      expect(
        source.messages.some((message) => message.results?.some((ref) => ref.resultId === row.id)),
      ).toBe(true)
    }
    const download = join(directory, 'download.png')
    await cli(['result', 'download', rows[0]?.id ?? '', '--output', download])
    expect(readFileSync(download)).toEqual(readFileSync(join(directory, 'version-2.png')))
  } finally {
    db.close()
  }
  await server.stop({ keepHome: true })
  server = await restartTestServer(server, daemonEnv)
  for (const id of savedIds) {
    const download = await fetch(`${server.url}/api/results/${id}/download`, {
      headers: { authorization: `Bearer ${server.token}` },
    })
    expect(download.status).toBe(200)
    expect(Buffer.from(await download.arrayBuffer())).toEqual(
      readFileSync(join(directory, 'version-2.png')),
    )
  }
  expect(readFileSync(calls, 'utf8').trim().split('\n')).toHaveLength(6)
  await cli(['config', 'set', 'BAZILION_IMAGE_GENERATION', 'off'])
  toolEnabled = false
  step = 0
  await cli(['agent', 'chat', agentId, '--message', 'Images are now disabled.'])
  expect(errors).toEqual([])
  expect(readFileSync(calls, 'utf8').trim().split('\n')).toHaveLength(6)
}, 60_000)
