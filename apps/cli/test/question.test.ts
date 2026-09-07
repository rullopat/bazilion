import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { spawnAgent } from '../../daemon/src/core/agent/spawn.ts'
import { openDb } from '../../daemon/src/core/db/client.ts'
import { resolvePaths } from '../../daemon/src/core/paths.ts'
import { createProfile } from '../../daemon/src/core/profile/create.ts'
import * as questions from '../../daemon/src/core/repos/questions.ts'
import { seedRegisteredConversation } from '../../daemon/test/fixtures/conversation.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

let server: TestServer
beforeAll(async () => {
  server = await startTestServer()
})
afterAll(() => server?.stop())
test('CLI reads released questions and reconciles an accepted answer without a waiting worker', async () => {
  const paths = resolvePaths(server.home)
  const db = openDb(paths.db)
  const requestId = randomUUID()
  let item: ReturnType<typeof questions.create>
  let hidden: ReturnType<typeof questions.create>
  try {
    createProfile(db, paths, { id: 'questions-cli', defaultModel: 'lmstudio:test' })
    const agent = spawnAgent(db, paths, { profileId: 'questions-cli', teamId: 'default' })
    const target = seedRegisteredConversation(db, paths, agent.id)
    const input = {
      agentId: agent.id,
      teamId: agent.teamId,
      conversationId: target.id,
      turnId: randomUUID(),
      toolCallId: 'ask-cli',
      question: { prompt: 'Format?', choices: [{ label: 'Text' }, { label: 'JSON' }] },
      binding: { route: 'web' },
    }
    item = questions.create(db, input)
    questions.markDelivered(db, agent.id, item.id)
    questions.answer(db, agent.id, item.id, {
      requestId,
      conversationId: target.id,
      answer: { kind: 'choice', index: 1 },
    })
    hidden = questions.create(db, { ...input, turnId: randomUUID(), toolCallId: 'held' })
  } finally {
    db.close()
  }
  const listed = await server.cli(['question', 'list', item.agentId])
  expect(listed.exitCode).toBe(0)
  expect(JSON.parse(listed.stdout).questions.map((q: { id: string }) => q.id)).toEqual([item.id])
  expect((await server.cli(['question', 'show', item.agentId, hidden.id])).exitCode).not.toBe(0)
  const retry = [
    'question',
    'answer',
    item.agentId,
    item.id,
    '--choice',
    '2',
    '--request-id',
    requestId,
    '--conversation',
    item.conversationId,
  ]
  const accepted = await server.cli(retry)
  expect(accepted.exitCode).toBe(0)
  expect(JSON.parse(accepted.stdout)).toMatchObject({
    kind: 'already_applied',
    question: { continuation: 'unconfirmed' },
  })
  const changed = await server.cli(retry.map((value) => (value === '2' ? '1' : value)))
  expect(changed.exitCode).not.toBe(0)
  const missingTarget = await server.cli(retry.slice(0, -2))
  expect(missingTarget.exitCode).not.toBe(0)
})
