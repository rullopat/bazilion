import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { extractAgentId } from './helpers.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

// This suite tests the inbox CLI / HTTP surface (list / show / read / replyTo)
// in isolation. Bazilion's scheduler runs inbox auto-delivery every tick,
// which would drain these tests' seeded messages and mark them read before
// the assertions run. We disable the scheduler for this fixture; the
// auto-delivery flow is covered end-to-end by `inbox-autodeliver.test.ts`.
let server: TestServer
beforeAll(async () => {
  server = await startTestServer({ BAZILION_SCHEDULER: 'off' })
})
afterAll(() => server.stop())
beforeEach(() => server.reset())

async function spawnTwoAgents(): Promise<{ a: string; b: string }> {
  await server.cli(['profile', 'create', 'p', '--model', 'm'])
  let r = await server.cli(['agent', 'spawn', '--profile', 'p'])
  const a = extractAgentId(r.stdout)
  r = await server.cli(['agent', 'spawn', '--profile', 'p'])
  const b = extractAgentId(r.stdout)
  return { a, b }
}

function firstIdFromSend(stdout: string): string {
  const m = stdout.match(/sent message ([\w-]+)/)
  if (!m?.[1]) throw new Error(`no message id in: ${stdout}`)
  return m[1]
}

function parseInboxIds(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('('))
    .map((l) => l.split(/\s+/)[0] ?? '')
    .filter((x) => x.length > 0)
}

test('inbox list shows sent messages', async () => {
  const { a, b } = await spawnTwoAgents()
  const send = await server.cli(['send', a, b, 'first'])
  const id = firstIdFromSend(send.stdout)

  const r = await server.cli(['inbox', 'list', b])
  expect(r.exitCode).toBe(0)
  expect(parseInboxIds(r.stdout)).toContain(id)
  expect(r.stdout).toContain('first')
  expect(r.stdout).toContain('NEW')
})

test('inbox list --unread filters out read messages', async () => {
  const { a, b } = await spawnTwoAgents()
  const s1 = await server.cli(['send', a, b, 'one'])
  const id1 = firstIdFromSend(s1.stdout)
  await server.cli(['send', a, b, 'two'])

  await server.cli(['inbox', 'read', id1])

  const all = await server.cli(['inbox', 'list', b])
  expect(parseInboxIds(all.stdout).length).toBe(2)

  const unread = await server.cli(['inbox', 'list', b, '--unread'])
  const unreadIds = parseInboxIds(unread.stdout)
  expect(unreadIds).not.toContain(id1)
  expect(unreadIds.length).toBe(1)
})

test('inbox show prints message body', async () => {
  const { a, b } = await spawnTwoAgents()
  const s = await server.cli(['send', a, b, 'hello body'])
  const id = firstIdFromSend(s.stdout)

  const r = await server.cli(['inbox', 'show', id])
  expect(r.exitCode).toBe(0)
  expect(r.stdout).toContain('hello body')
  expect(r.stdout).toContain(`id:        ${id}`)
  expect(r.stdout).toContain(`from:      ${a}`)
})

test('inbox read marks a message read', async () => {
  const { a, b } = await spawnTwoAgents()
  const s = await server.cli(['send', a, b, 'mark me'])
  const id = firstIdFromSend(s.stdout)

  const before = await server.cli(['inbox', 'show', id])
  expect(before.stdout).toContain('read:      (unread)')

  const r = await server.cli(['inbox', 'read', id])
  expect(r.exitCode).toBe(0)
  expect(r.stdout).toContain(`marked read: ${id}`)

  const after = await server.cli(['inbox', 'show', id])
  expect(after.stdout).not.toContain('(unread)')
})

test('inbox show fails for unknown message id', async () => {
  await server.cli(['profile', 'create', 'p', '--model', 'm'])
  const r = await server.cli(['inbox', 'show', 'nope-not-real'])
  expect(r.exitCode).not.toBe(0)
  expect(r.stderr + r.stdout).toContain('message not found')
})

test('POST with replyTo links the messages', async () => {
  const { a, b } = await spawnTwoAgents()
  const first = await server.cli(['send', a, b, 'please reply'])
  const firstId = firstIdFromSend(first.stdout)

  const res = await fetch(`${server.url}/api/agents/${a}/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `bz_token=${server.token}`,
    },
    body: JSON.stringify({
      from: b,
      payload: { text: 'here is a reply' },
      replyTo: firstId,
    }),
  })
  expect(res.status).toBe(201)
  const msg = (await res.json()) as { id: string; replyTo: string | null }
  expect(msg.replyTo).toBe(firstId)

  const show = await server.cli(['inbox', 'show', msg.id])
  expect(show.stdout).toContain(`reply_to:  ${firstId}`)
})

test('POST replyTo to missing message is rejected', async () => {
  const { a, b } = await spawnTwoAgents()
  const res = await fetch(`${server.url}/api/agents/${b}/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `bz_token=${server.token}`,
    },
    body: JSON.stringify({
      from: a,
      payload: { text: 'ghost reply' },
      replyTo: 'not-a-real-id',
    }),
  })
  expect(res.status).toBe(404)
  const err = (await res.json()) as { error: string }
  expect(err.error).toContain('reply target not found')
})
