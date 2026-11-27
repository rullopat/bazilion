// Helpers end to end (BAZ-092): a turn starts a helper and waits for it; the helper is a turn of
// its own, in a conversation of its own and without the helper tools, and its answer comes back.
import type { IncomingMessage, ServerResponse } from 'node:http'
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
  })
})

afterAll(async () => {
  await server?.stop()
  await mock?.stop()
})

interface Body {
  messages: Array<{ role: string; content: unknown }>
  tools?: Array<{ function: { name: string } }>
}

const text = (content: string): CannedResponse => ({
  choices: [{ message: { role: 'assistant', content } }],
})

test('a helper works in its own conversation and its answer comes back to the turn', async () => {
  const seen: { parent: Body[]; helper: Body[] } = { parent: [], helper: [] }
  let helperId = ''
  // Requests come from two turns at once: each is answered by who is asking.
  mock.setFallback(async (req: IncomingMessage, res: ServerResponse) => {
    let raw = ''
    for await (const chunk of req) raw += String(chunk)
    const body = JSON.parse(raw) as Body
    const all = JSON.stringify(body.messages)
    if (all.includes('You are a helper')) {
      seen.helper.push(body)
      return sseFromCanned(res, text('HELPER ANSWER: the second source agrees.'))
    }
    seen.parent.push(body)
    const tools = body.messages.filter((m) => m.role === 'tool').map((m) => String(m.content))
    const started = tools.find((t) => t.startsWith('Started helper-'))
    if (!started)
      return sseFromCanned(res, toolCall('helper_start', { task: 'Read the second source.' }))
    helperId = /Started (helper-[0-9a-f]+)/.exec(started)?.[1] ?? ''
    if (!tools.some((t) => t.includes('Its answer:')))
      return sseFromCanned(res, toolCall('helper_wait', { id: helperId }))
    return sseFromCanned(res, text('PARENT DONE'))
  })

  await server.cli(['profile', 'create', 'helpers', '--model', 'lmstudio:test-model'])
  const agent = extractAgentId(
    (await server.cli(['agent', 'spawn', '--profile', 'helpers'])).stdout,
  )
  const chat = await server.cli(['agent', 'chat', agent, '--message', 'Compare two sources.'])
  expect(chat.exitCode, chat.stderr).toBe(0)
  expect(chat.stdout).toContain('PARENT DONE')

  // The answer came back to the waiting turn.
  const last = seen.parent.at(-1)
  expect(JSON.stringify(last?.messages)).toContain('HELPER ANSWER: the second source agrees.')
  // The parent has the helper tools; the helper has neither them nor ask_user.
  const names = (body: Body | undefined) => (body?.tools ?? []).map((tool) => tool.function.name)
  expect(names(seen.parent[0])).toEqual(
    expect.arrayContaining(['helper_start', 'helper_wait', 'helper_stop']),
  )
  expect(seen.helper.length).toBeGreaterThan(0)
  for (const name of ['helper_start', 'helper_wait', 'helper_stop', 'ask_user', 'secret_request'])
    expect(names(seen.helper[0])).not.toContain(name)

  // Listed as done, in a conversation of its own that is not the selected one.
  const helpers = await server.cli(['agent', 'helpers', agent])
  expect(helpers.stdout).toContain(helperId)
  expect(helpers.stdout).toContain('done')
  expect(helpers.stdout).toContain('Read the second source.')
  const after = JSON.parse(
    (await server.cli(['conversation', 'list', agent, '--json'])).stdout,
  ) as {
    selectedId: string
    conversations: Array<{ id: string; title: string }>
  }
  const own = after.conversations.find((c) => c.title === 'Helper: Read the second source.')
  expect(own).toBeDefined()
  expect(after.selectedId).not.toBe(own?.id)
  expect((await server.cli(['agent', 'helpers', agent, '--stop', 'all'])).stdout).toContain(
    'no helper is running',
  )
})
