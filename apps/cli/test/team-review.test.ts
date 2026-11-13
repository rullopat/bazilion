import { writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { runGit } from '../../daemon/test/fixtures/git.ts'
import { extractAgentId } from './helpers.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

let server: TestServer
const received: string[] = []
const fake = createServer(async (request, response) => {
  let raw = ''
  for await (const chunk of request) raw += chunk
  received.push(raw)
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.write(
    `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: 'Noted.' }, finish_reason: 'stop' }] })}\n\n`,
  )
  response.end('data: [DONE]\n\n')
})

beforeAll(async () => {
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve))
  const address = fake.address()
  if (!address || typeof address === 'string') throw new Error('Missing port')
  server = await startTestServer({
    LMSTUDIO_URL: `http://127.0.0.1:${address.port}/v1`,
    BAZILION_SCHEDULER: 'off',
    BAZILION_PUBLIC_ORIGIN: '',
    TELEGRAM_BOT_TOKEN: '',
  })
})
afterAll(async () => {
  await server?.stop()
  await new Promise<void>((resolve) => fake.close(() => resolve()))
})

const git = (...args: string[]) =>
  runGit(join(server.home, 'teams', 'default'), server.home, ...args)

test('team review lists changes, prints diffs on request and queues file feedback', async () => {
  const root = join(server.home, 'teams', 'default')
  git('init', '-q', '-b', 'main')
  writeFileSync(join(root, 'app.txt'), 'one\ntwo\n')
  git('add', 'app.txt')
  git('commit', '-qm', 'base')
  writeFileSync(join(root, 'app.txt'), 'one\ntwo\nthree\n')
  writeFileSync(join(root, 'notes.md'), 'new notes\n')

  const shown = await server.cli(['team', 'review', 'show', 'default'])
  expect(shown.exitCode, shown.stderr).toBe(0)
  expect(shown.stdout).toMatch(/modified\s+app\.txt\s+1\+ 0-/)
  expect(shown.stdout).toMatch(/untracked\s+notes\.md/)
  // A new file has a diff too, fetched only when asked for.
  const patch = await server.cli(['team', 'review', 'show', 'default', '--patch', 'notes.md'])
  expect(patch.exitCode, patch.stderr).toBe(0)
  expect(patch.stdout).toContain('+new notes')

  expect(
    (await server.cli(['profile', 'create', 'coder', '--model', 'lmstudio:test-model'])).exitCode,
  ).toBe(0)
  const agent = extractAgentId((await server.cli(['agent', 'spawn', '--profile', 'coder'])).stdout)
  const queued = await server.cli([
    'team',
    'review',
    'feedback',
    'default',
    '--path',
    'app.txt',
    '--agent',
    agent,
    '--note',
    'Keep the list ordered.',
  ])
  expect(queued.exitCode, queued.stderr).toBe(0)
  expect(queued.stdout).toContain('Review feedback on app.txt (modified since HEAD')
  expect(queued.stdout).toContain('+three')
  // The queue delivers it to the Agent as its next turn.
  await expect
    .poll(() => received.some((body) => body.includes('Keep the list ordered.')), {
      timeout: 15_000,
    })
    .toBe(true)
})
