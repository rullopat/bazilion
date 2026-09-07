import { fileURLToPath } from 'node:url'
import type { AgentQuestion, AgentQuestionInput } from '@bazilion/api-types'
import { expect, test, vi } from 'vitest'
import { createProfile, resolveAgent, spawnAgent } from '../../src/core/index.ts'
import * as questions from '../../src/core/repos/questions.ts'
import { askUserTool } from '../../src/runtime/tools/ask-user.ts'
import { spawnWorkerTurn } from '../../src/runtime/worker/spawn.ts'
import { makeTestEnv } from '../core/helpers.ts'
import { seedRegisteredConversation } from '../fixtures/conversation.ts'

test.each([
  'valid',
  'forged',
  'unsupported',
] as const)('worker question IPC %s preserves host ownership', async (mode) => {
  const env = makeTestEnv()
  createProfile(env.db, env.paths, { id: 'question-ipc', defaultModel: 'lmstudio:test' })
  const agent = spawnAgent(env.db, env.paths, { profileId: 'question-ipc', teamId: env.teamId })
  const target = seedRegisteredConversation(env.db, env.paths, agent.id)
  let onQuestion: ((question: AgentQuestion) => void) | undefined
  const ask = vi.fn(async (toolCallId: string, question: AgentQuestionInput) => {
    const item = questions.create(env.db, {
      agentId: agent.id,
      teamId: env.teamId,
      conversationId: target.id,
      turnId: 'bound-turn',
      toolCallId,
      question,
      binding: { route: 'fixture' },
    })
    onQuestion?.(questions.markDelivered(env.db, agent.id, item.id))
    return {
      questionId: item.id,
      question,
      kind: 'answer' as const,
      answer: { kind: 'choice' as const, index: 1 },
    }
  })
  const close = vi.fn()
  const unsubscribe = vi.fn()
  const host = {
    ask,
    consumed: vi.fn(),
    close,
    subscribe: vi.fn((listener: (question: AgentQuestion) => void) => {
      onQuestion = listener
      return unsubscribe
    }),
  }
  try {
    const frames = []
    for await (const frame of spawnWorkerTurn(
      {
        kind: 'configured_operator_http',
        agent: resolveAgent(env.db, env.paths, agent.id),
        conversation: { id: target.id, filename: `${target.id}.jsonl` },
        message: mode,
        enabledProviders: ['lmstudio'],
        turnId: 'bound-turn',
        bashApprovalMode: 'auto_deny',
        ...(mode !== 'unsupported' ? { questionEnabled: true } : {}),
      },
      {
        env: {},
        workerEntryPath: fileURLToPath(
          new URL('../fixtures/worker-question-entry.ts', import.meta.url),
        ),
        ...(mode !== 'unsupported' ? { questionHost: host } : {}),
      },
    ))
      frames.push(frame)
    if (mode === 'valid') {
      expect(frames).toContainEqual({ kind: 'done', messages: [] })
      expect(
        frames.some(
          (frame) =>
            frame.kind === 'event' &&
            frame.event.type === 'agent_question' &&
            frame.event.question.agentId === agent.id,
        ),
      ).toBe(true)
      expect(ask).toHaveBeenCalledWith('actual-tool-call', {
        prompt: 'Format?',
        choices: [{ label: 'Text' }, { label: 'JSON' }],
      })
      expect(host.consumed).toHaveBeenCalledExactlyOnceWith(expect.any(String), 'actual-tool-call')
    } else {
      expect(frames.some((frame) => frame.kind === 'fatal')).toBe(true)
      expect(ask).not.toHaveBeenCalled()
      expect(host.consumed).not.toHaveBeenCalled()
    }
    if (mode !== 'unsupported') {
      expect(close).toHaveBeenCalledOnce()
      expect(unsubscribe).toHaveBeenCalledOnce()
    }
  } finally {
    env.cleanup()
  }
})

test('ask_user uses the adapter tool identity and returns explicit no-answer data', async () => {
  const question = { prompt: 'Format?', choices: [{ label: 'Text' }, { label: 'JSON' }] }
  const ask = vi.fn(async () => ({
    questionId: 'daemon-id',
    question,
    kind: 'no_answer' as const,
    reason: 'skipped' as const,
  }))
  const tool = askUserTool(ask)
  await expect(tool.invoke(question)).rejects.toThrow('actual tool call')
  const result = await tool.invoke(question, { toolCallId: 'pi-tool-call' })
  expect(ask).toHaveBeenCalledWith('pi-tool-call', question)
  expect(JSON.parse(String(result))).toMatchObject({
    questionId: 'daemon-id',
    kind: 'no_answer',
    reason: 'skipped',
  })
})
