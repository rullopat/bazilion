import { fileURLToPath } from 'node:url'
import { expect, test, vi } from 'vitest'
import { createProfile, resolveAgent, spawnAgent } from '../../src/core/index.ts'
import { QuestionRegistry } from '../../src/lib/questions.ts'
import { askUserTool } from '../../src/runtime/tools/ask-user.ts'
import { spawnWorkerTurn } from '../../src/runtime/worker/spawn.ts'
import { makeTestEnv } from '../core/helpers.ts'
import { seedRegisteredConversation } from '../fixtures/conversation.ts'

test.each([
  'answered',
  'unsupported',
] as const)('a worker question over IPC is %s by the daemon-bound host', async (mode) => {
  const env = makeTestEnv()
  createProfile(env.db, env.paths, { id: 'question-ipc', defaultModel: 'lmstudio:test' })
  const agent = spawnAgent(env.db, env.paths, { profileId: 'question-ipc', teamId: env.teamId })
  const target = seedRegisteredConversation(env.db, env.paths, agent.id)
  const registry = new QuestionRegistry()
  const host = {
    ask: vi.fn((question: unknown, signal?: AbortSignal) =>
      registry.ask({ agentId: agent.id, conversationId: target.id }, question, signal),
    ),
  }
  try {
    const frames = []
    for await (const frame of spawnWorkerTurn(
      {
        kind: 'agent_turn',
        repositoryInstructions: [],
        agent: resolveAgent(env.db, env.paths, agent.id),
        conversation: { id: target.id },
        message: mode,
        turnId: 'bound-turn',
        bashApprovalMode: 'auto_deny',
      },
      {
        env: {},
        workerEntryPath: fileURLToPath(
          new URL('../fixtures/worker-question-entry.ts', import.meta.url),
        ),
        ...(mode === 'answered' ? { questionHost: host } : {}),
      },
    )) {
      frames.push(frame)
      if (frame.kind === 'event' && frame.event.type === 'agent_question') {
        expect(frame.event.question).toMatchObject({ agentId: agent.id, conversationId: target.id })
        registry.answer(agent.id, frame.event.question.id, { kind: 'choice', index: 1 })
      }
    }
    if (mode === 'answered') {
      expect(frames).toContainEqual({ kind: 'done', messages: [] })
      expect(host.ask).toHaveBeenCalledOnce()
    } else {
      expect(frames.some((frame) => frame.kind === 'fatal')).toBe(true)
      expect(host.ask).not.toHaveBeenCalled()
    }
    expect(registry.list()).toEqual([])
  } finally {
    env.cleanup()
  }
})

test('ask_user returns the outcome, including no answer, as JSON for the model', async () => {
  const question = { prompt: 'Format?', choices: [{ label: 'Text' }, { label: 'JSON' }] }
  const ask = vi.fn(async () => ({
    questionId: 'daemon-id',
    question,
    kind: 'no_answer' as const,
    reason: 'skipped' as const,
  }))
  const result = await askUserTool(ask).invoke(question)
  expect(ask).toHaveBeenCalledWith(question)
  expect(JSON.parse(String(result))).toMatchObject({
    questionId: 'daemon-id',
    kind: 'no_answer',
    reason: 'skipped',
  })
})
