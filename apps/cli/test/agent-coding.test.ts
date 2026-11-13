import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { extractAgentId } from './helpers.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

let server: TestServer
let requests = 0
const failures: string[] = []
const received: unknown[] = []
const plan = [
  ['bash', { command: 'node -e "require(\'fixture-dep\')"', timeout: 5 }],
  [
    'bash',
    {
      command: 'pnpm install --offline --frozen-lockfile --ignore-scripts --store-dir .pnpm-store',
      timeout: 5,
    },
  ],
  [
    'bash',
    {
      command: "node -e \"require('node:assert').equal(require('fixture-dep'),42)\"",
      timeout: 5,
    },
  ],
] as const
const fake = createServer(async (request, response) => {
  try {
    let raw = ''
    for await (const bytes of request) raw += bytes
    const body = JSON.parse(raw)
    if (!body.tools.some((t: { function: { name: string } }) => t.function.name === 'bash'))
      throw new Error('Missing bash')
    received.push(body.messages)
    const step = plan[requests++]
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
        { content: 'TASK_COMPLETE: Local preparation succeeded and the scoped test passed.' },
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
    BAZILION_BASH_SANDBOX: 'off',
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
  expect(requests).toBe(4)
  // The first check fails before preparation; the Agent sees that and repairs it.
  expect(JSON.stringify(received)).toContain('Command exited with code 1')
  // The CLI shows the running command's output live.
  expect(chat.stdout).toMatch(/^ {2}\| .*Cannot find module 'fixture-dep'/m)
  expect(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')).toBe(lock)
})

test('Team Docker defaults have CLI and API parity and never execute commands', async () => {
  const before = requests
  mkdirSync(join(server.home, 'teams/default/app'), { recursive: true })
  const saved = await server.cli([
    'team',
    'environment',
    'set',
    'default',
    '--image',
    'bazilion-coding:node26-pnpm12',
    '--cwd',
    'app',
  ])
  expect(saved.exitCode, saved.stderr).toBe(0)
  expect(saved.stdout).toContain('image:   bazilion-coding:node26-pnpm12')
  expect(saved.stdout).toContain('cwd:     app')
  const shown = await server.cli(['team', 'environment', 'show', 'default', '--json'])
  expect(shown.exitCode, shown.stderr).toBe(0)
  const url = `${server.url}/api/teams/default/coding-environment`
  expect((await fetch(url)).status).toBe(401)
  const response = await fetch(url, { headers: { authorization: `Bearer ${server.token}` } })
  const status = await response.json()
  expect(status).toEqual(JSON.parse(shown.stdout))
  expect(status).toMatchObject({ image: 'bazilion-coding:node26-pnpm12', cwd: 'app' })

  // Only the image changes; an empty image goes back to the installation default.
  expect(
    (await server.cli(['team', 'environment', 'set', 'default', '--image', ''])).exitCode,
  ).toBe(0)
  expect(
    JSON.parse((await server.cli(['team', 'environment', 'show', 'default', '--json'])).stdout),
  ).toMatchObject({ image: null, cwd: 'app' })

  const invalid = await fetch(url, {
    method: 'PUT',
    headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ image: null, cwd: '.', env: { CI: 'true' } }),
  })
  expect(invalid.status).toBe(400)
  expect(
    (await server.cli(['team', 'environment', 'set', 'default', '--cwd', '../outside'])).exitCode,
  ).not.toBe(0)
  expect(requests).toBe(before)
})
