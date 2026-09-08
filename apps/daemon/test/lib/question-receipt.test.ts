import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { AgentQuestionToolResult } from '@bazilion/api-types'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { pauseRestoredUserQueue } from '../../../cli/src/backup-queue-recovery.ts'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { openDb } from '../../src/core/db/client.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as questions from '../../src/core/repos/questions.ts'
import { mergeSecretsIntoEnv } from '../../src/core/secrets.ts'
import { authorizeHttpChatFrame } from '../../src/lib/communication.ts'
import { questionHistoryVisibility } from '../../src/lib/question-history.ts'
import { signQuestionReceipt, verifyQuestionReceipt } from '../../src/lib/question-receipt.ts'
import { piMessagesToProviderView } from '../../src/runtime/pi/events.ts'
import { askUserTool } from '../../src/runtime/tools/ask-user.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'
import { seedRegisteredConversation } from '../fixtures/conversation.ts'

let env: TestEnv
let item: ReturnType<typeof questions.create>
let result: AgentQuestionToolResult
beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, { id: 'receipt', defaultModel: 'lmstudio:test' })
  const agent = spawnAgent(env.db, env.paths, { profileId: 'receipt', teamId: env.teamId })
  const target = seedRegisteredConversation(env.db, env.paths, agent.id)
  item = questions.create(env.db, {
    agentId: agent.id,
    teamId: env.teamId,
    conversationId: target.id,
    turnId: randomUUID(),
    toolCallId: 'receipt-call',
    question: { prompt: 'Private format?', choices: [{ label: 'Text' }, { label: 'JSON' }] },
    binding: { route: 'web' },
  })
  result = {
    questionId: item.id,
    question: item.question,
    kind: 'answer',
    answer: { kind: 'choice', index: 1 },
  }
})
afterEach(() => {
  env.cleanup()
  vi.unstubAllEnvs()
})
function accept() {
  questions.markDelivered(env.db, item.agentId, item.id)
  questions.answer(env.db, item.agentId, item.id, {
    requestId: randomUUID(),
    conversationId: item.conversationId,
    answer: { kind: 'choice', index: 1 },
  })
}
test('only released settled results receive proof; altered content and signatures fail closed', () => {
  expect(signQuestionReceipt(env.db, item.agentId, result)).toBeUndefined()
  accept()
  const receipt = signQuestionReceipt(env.db, item.agentId, result)
  expect(receipt).toBeTruthy()
  expect(verifyQuestionReceipt(env.db, receipt, JSON.stringify(result))).toMatchObject({
    agentId: item.agentId,
    conversationId: item.conversationId,
    toolCallId: item.toolCallId,
  })
  expect(
    verifyQuestionReceipt(env.db, receipt, JSON.stringify({ ...result, questionId: randomUUID() })),
  ).toBeNull()
  expect(verifyQuestionReceipt(env.db, `${receipt}0`, JSON.stringify(result))).toBeNull()
  expect(() =>
    signQuestionReceipt(env.db, item.agentId, {
      ...result,
      question: { ...item.question, prompt: 'Substitution' },
    }),
  ).toThrow('differs')
})
test('proof survives record pruning and offline restore without exporting its signing key', () => {
  accept()
  const receipt = signQuestionReceipt(env.db, item.agentId, result)
  questions.closeTurn(env.db, item.turnId, 'worker_lost')
  questions.prune(env.db, Date.now() + 8 * 24 * 60 * 60 * 1000)
  expect(questions.get(env.db, item.agentId, item.id)).toBeNull()
  const path = join(env.home, 'receipt-restore.db')
  env.db.raw.run('VACUUM INTO ?', [path])
  pauseRestoredUserQueue(path)
  const restored = openDb(path)
  try {
    expect(verifyQuestionReceipt(restored, receipt, JSON.stringify(result))).not.toBeNull()
    expect(mergeSecretsIntoEnv(restored, 'different-bootstrap-password', {})).toEqual({})
  } finally {
    restored.close()
  }
  const foreign = makeTestEnv()
  try {
    expect(verifyQuestionReceipt(foreign.db, receipt, JSON.stringify(result))).toBeNull()
  } finally {
    foreign.cleanup()
  }
})
test('the tool adapter keeps provenance outside provider-facing text', async () => {
  accept()
  const receipt = signQuestionReceipt(env.db, item.agentId, result)
  const output = await askUserTool(async () => ({ ...result, receipt })).invoke(
    item.question as unknown as Record<string, unknown>,
    { toolCallId: item.toolCallId },
  )
  expect(output).toEqual({
    content: [{ type: 'text', text: JSON.stringify(result) }],
    questionReceipt: receipt,
  })
})
test('public history needs signed result, exact source and current policy, even after pruning', () => {
  accept()
  const receipt = signQuestionReceipt(env.db, item.agentId, result)
  const message = {
    role: 'toolResult',
    toolName: 'ask_user',
    toolCallId: item.toolCallId,
    isError: false,
    content: [{ type: 'text', text: JSON.stringify(result) }],
    details: { questionReceipt: receipt },
  } as unknown as AgentMessage
  vi.stubEnv('BAZILION_TEAM_POLICY_ENFORCEMENT', 'off')
  const view = (messages: AgentMessage[], conversation = item.conversationId) =>
    piMessagesToProviderView(
      messages,
      questionHistoryVisibility(env.db, item.agentId, conversation),
    )
  expect(JSON.stringify(piMessagesToProviderView([message]))).not.toContain('Private format')
  expect(JSON.stringify(view([message]))).toContain('Private format')
  expect(JSON.stringify(view([message], randomUUID()))).not.toContain('Private format')
  const unsigned = { ...message, details: {} } as AgentMessage
  expect(JSON.stringify(view([unsigned]))).not.toContain('Private format')
  questions.closeTurn(env.db, item.turnId, 'worker_lost')
  questions.prune(env.db, Date.now() + 8 * 24 * 60 * 60 * 1000)
  expect(JSON.stringify(view([message]))).toContain('Private format')
  vi.stubEnv('BAZILION_TEAM_POLICY_ENFORCEMENT', 'on')
  env.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', [item.teamId])
  expect(JSON.stringify(view([message]))).not.toContain('Private format')
})
test('HTTP card emission rechecks canonical content and current policy without another approval', () => {
  vi.stubEnv('BAZILION_TEAM_POLICY_ENFORCEMENT', 'off')
  const frame = {
    kind: 'event' as const,
    event: {
      type: 'agent_question' as const,
      question: { ...item, question: { ...item.question, prompt: 'Substituted card' } },
    },
  }
  expect(() => authorizeHttpChatFrame(env.db, item.agentId, 'stream', 0, frame)).toThrow(
    'no longer available',
  )
  accept()
  authorizeHttpChatFrame(env.db, item.agentId, 'stream', 0, frame)
  expect(frame.event.question.question.prompt).toBe(item.question.prompt)
  vi.stubEnv('BAZILION_TEAM_POLICY_ENFORCEMENT', 'on')
  env.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', [item.teamId])
  expect(() => authorizeHttpChatFrame(env.db, item.agentId, 'stream', 1, frame)).toThrow(
    'no longer available',
  )
})
