import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { openDb } from '../../daemon/src/core/db/client.ts'
import { extractAgentId } from './helpers.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

let server: TestServer
let requests = 0
let missingArtifact = false
const failures: string[] = []
const received: unknown[] = []
const plan = [
  ['coding_environment', { target: '.' }],
  [
    'coding_command',
    { command: 'node -e "require(\'fixture-dep\')"', cwd: '.', purpose: 'test', timeoutSeconds: 5 },
  ],
  [
    'coding_command',
    {
      command: 'pnpm install --offline --frozen-lockfile --ignore-scripts --store-dir .pnpm-store',
      cwd: '.',
      purpose: 'prepare',
      timeoutSeconds: 5,
    },
  ],
  [
    'coding_command',
    {
      command: "node -e \"require('node:assert').equal(require('fixture-dep'),42)\"",
      cwd: '.',
      purpose: 'test',
      timeoutSeconds: 5,
    },
  ],
] as const
const fake = createServer(async (request, response) => {
  try {
    let raw = ''
    for await (const bytes of request) raw += bytes
    const body = JSON.parse(raw)
    for (const name of [
      'repository_context',
      'coding_environment',
      'coding_command',
      'coding_receipt',
    ])
      if (!body.tools.some((t: { function: { name: string } }) => t.function.name === name))
        throw new Error(`Missing ${name}`)
    received.push(body.messages)
    const step = missingArtifact
      ? requests++ === 0
        ? ([
            'coding_command',
            {
              command:
                'pnpm add --offline is-number@7.0.0 --ignore-scripts --store-dir .pnpm-store',
              cwd: 'missing',
              purpose: 'prepare',
              timeoutSeconds: 10,
            },
          ] as const)
        : undefined
      : plan[requests++]
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const chunk = (delta: unknown, finish: string | null = null) =>
      response.write(
        `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
      )
    chunk({ role: 'assistant' })
    if (step)
      chunk(
        {
          tool_calls: [
            {
              index: 0,
              id: `coding-${requests}`,
              type: 'function',
              function: { name: step[0], arguments: JSON.stringify(step[1]) },
            },
          ],
        },
        'tool_calls',
      )
    else
      chunk(
        {
          content: missingArtifact
            ? 'BLOCKED: is-number@7.0.0 is missing from the offline store. Supply that package artifact before retrying.'
            : 'TASK_COMPLETE: Local preparation succeeded and the scoped test passed.',
        },
        'stop',
      )
    response.end('data: [DONE]\n\n')
  } catch (error) {
    failures.push(String(error))
    response.writeHead(500)
    response.end('fixture failed')
  }
})
beforeAll(async () => {
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve))
  const address = fake.address()
  if (!address || typeof address === 'string') throw new Error('Missing port')
  server = await startTestServer({
    LMSTUDIO_URL: `http://127.0.0.1:${address.port}/v1`,
    BAZILION_SCHEDULER: 'off',
    BAZILION_PUBLIC_ORIGIN: '',
    BAZILION_BASH_SANDBOX: process.env.BAZILION_TEST_DOCKER === '1' ? 'docker' : 'off',
    BAZILION_BASH_SANDBOX_IMAGE:
      process.env.BAZILION_TEST_DOCKER_IMAGE ?? 'bazilion-coding:node24-pnpm10',
    TELEGRAM_BOT_TOKEN: '',
  })
})
afterAll(async () => {
  await server?.stop()
  await new Promise<void>((resolve) => fake.close(() => resolve()))
})
test('a real Agent turn discovers and repairs prerequisites with no operator checklist', async () => {
  const root = join(server.home, 'teams', 'default')
  writeFileSync(
    join(root, 'AGENTS.md'),
    'Use the local fixture artifact when dependencies are missing.\n',
  )
  mkdirSync(join(root, 'vendor/fixture-dep'), { recursive: true })
  writeFileSync(join(root, 'vendor/fixture-dep/index.js'), 'module.exports = 42')
  writeFileSync(
    join(root, 'vendor/fixture-dep/package.json'),
    JSON.stringify({ name: 'fixture-dep', version: '1.0.0', main: 'index.js' }),
  )
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'coding-fixture',
      private: true,
      dependencies: { 'fixture-dep': 'file:vendor/fixture-dep' },
    }),
  )
  writeFileSync(
    join(root, 'pnpm-lock.yaml'),
    `lockfileVersion: '9.0'
settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false
importers:
  .:
    dependencies:
      fixture-dep:
        specifier: file:vendor/fixture-dep
        version: file:vendor/fixture-dep
packages:
  fixture-dep@file:vendor/fixture-dep:
    resolution: {directory: vendor/fixture-dep, type: directory}
snapshots:
  fixture-dep@file:vendor/fixture-dep: {}
`,
  )
  const lock = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')
  expect(
    (await server.cli(['profile', 'create', 'coder', '--model', 'lmstudio:test-model'])).exitCode,
  ).toBe(0)
  const agent = extractAgentId((await server.cli(['agent', 'spawn', '--profile', 'coder'])).stdout)
  const chat = await server.cli([
    'agent',
    'chat',
    agent,
    '--message',
    'Run the test and prepare what is missing from local artifacts.',
  ])
  expect(failures).toEqual([])
  expect(chat.exitCode, chat.stderr).toBe(0)
  expect(chat.stdout).toContain('TASK_COMPLETE')
  expect(requests).toBe(5)
  expect(JSON.stringify(received)).toContain('failed')
  expect(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')).toBe(lock)
  const db = openDb(join(server.home, 'bazilion.db'))
  try {
    const rows = db.raw
      .query<{ receipt_json: string }, []>(
        'SELECT receipt_json FROM coding_commands ORDER BY created_at',
      )
      .all()
      .map((r) => JSON.parse(r.receipt_json))
    expect(
      rows.map((r) => r.state),
      JSON.stringify(rows),
    ).toEqual(['failed', 'succeeded', 'succeeded'])
    expect(rows.map((r) => r.input.purpose)).toEqual(['test', 'prepare', 'test'])
    expect(
      rows.every(
        (r) =>
          r.agentId === agent &&
          r.environment.posture === (process.env.BAZILION_TEST_DOCKER === '1' ? 'docker' : 'host'),
      ),
    ).toBe(true)
    expect(
      db.raw.query<{ n: number }, []>('SELECT count(*) AS n FROM team_coding_environments').get()
        ?.n,
    ).toBe(0)
    await expect
      .poll(
        () =>
          db.raw.query<{ n: number }, []>('SELECT count(*) AS n FROM workspace_writers').get()?.n,
      )
      .toBe(0)
  } finally {
    db.close()
  }
  const old = await fetch(`${server.url}/api/teams/default/coding-environment/probes`, {
    headers: { authorization: `Bearer ${server.token}` },
  })
  expect(old.status).toBe(404)
})

test.skipIf(process.env.BAZILION_TEST_DOCKER !== '1')(
  'missing downloadable artifacts produce a concrete blocker with no host fallback',
  async () => {
    missingArtifact = true
    requests = 0
    const root = join(server.home, 'teams/default/missing')
    mkdirSync(root)
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'missing-artifact-fixture', private: true }),
    )
    const agent = extractAgentId(
      (await server.cli(['agent', 'spawn', '--profile', 'coder'])).stdout,
    )
    const chat = await server.cli([
      'agent',
      'chat',
      agent,
      '--message',
      'Prepare is-number from available offline packages.',
    ])
    expect(chat.exitCode, chat.stderr).toBe(0)
    expect(chat.stdout).toContain('BLOCKED: is-number@7.0.0')
    const db = openDb(join(server.home, 'bazilion.db'))
    try {
      const row = db.raw
        .query<{ receipt_json: string }, [string]>(
          'SELECT receipt_json FROM coding_commands WHERE agent_id = ?',
        )
        .get(agent)!
      const receipt = JSON.parse(row.receipt_json)
      expect(receipt).toMatchObject({ state: 'failed', environment: { posture: 'docker' } })
      expect(receipt.diagnostic).toContain('ERR_PNPM_NO_OFFLINE_META')
      expect(requests).toBe(2)
      expect(failures).toEqual([])
    } finally {
      db.close()
    }
  },
)

test('optional defaults retain authenticated API and CLI parity without executing commands', async () => {
  const before = requests
  const file = join(server.home, 'optional-defaults.json')
  const config = { image: 'bazilion-coding:node24-pnpm10', cwd: '.', env: { CI: 'true' } }
  writeFileSync(file, JSON.stringify({ expectedRevision: 0, config }))
  const saved = await server.cli(['team', 'environment', 'configure', 'default', '--file', file])
  expect(saved.exitCode, saved.stderr).toBe(0)
  expect(JSON.parse(saved.stdout)).toMatchObject({ revision: 1, config })
  const shown = await server.cli(['team', 'environment', 'show', 'default'])
  expect(shown.exitCode).toBe(0)
  const url = `${server.url}/api/teams/default/coding-environment`
  expect((await fetch(url)).status).toBe(401)
  const response = await fetch(url, { headers: { authorization: `Bearer ${server.token}` } })
  expect(await response.json()).toEqual(JSON.parse(shown.stdout))
  expect(
    (await server.cli(['team', 'environment', 'configure', 'default', '--file', file])).exitCode,
  ).not.toBe(0)
  expect(requests).toBe(before)
})
