import { isDeepStrictEqual } from 'node:util'
import type {
  AgentQuestion,
  AgentQuestionToolResult,
  ConversationTarget,
} from '@bazilion/api-types'
import type { Paths } from '../core/paths.ts'
import { parseQuestionInput } from './question-input.ts'
import { readResultSession } from './result-source.ts'

/** Verify Pi's saved tool call and result, never just a worker event or an accepted HTTP reply. */
export function verifyQuestionConsumption(
  paths: Paths,
  question: AgentQuestion,
  target: ConversationTarget,
  turnStartEntry = 1,
): void {
  if (
    target.id !== question.conversationId ||
    !['answered', 'skipped', 'expired'].includes(question.status)
  )
    throw new Error('Question has no consumable outcome')
  const expected: AgentQuestionToolResult =
    question.status === 'answered' && question.answer && question.answer.kind !== 'skip'
      ? {
          questionId: question.id,
          question: question.question,
          kind: 'answer',
          answer: question.answer,
        }
      : {
          questionId: question.id,
          question: question.question,
          kind: 'no_answer',
          reason: question.noAnswerReason ?? 'cancelled',
        }
  const entries = readResultSession(paths, question.agentId, target.filename, target.id)
  let callFound = false
  let resultFound = false
  if (!Number.isSafeInteger(turnStartEntry) || turnStartEntry < 1)
    throw new Error('Invalid question turn transcript boundary')
  for (const entry of entries.slice(turnStartEntry)) {
    if (entry.type !== 'message') continue
    const message = entry.message
    if (message.role === 'assistant') {
      for (const block of message.content) {
        if (block.type !== 'toolCall' || block.id !== question.toolCallId) continue
        if (
          callFound ||
          block.name !== 'ask_user' ||
          !isDeepStrictEqual(parseQuestionInput(block.arguments), question.question)
        )
          throw new Error('Question transcript call binding differs')
        callFound = true
      }
    }
    if (message.role === 'toolResult' && message.toolCallId === question.toolCallId) {
      if (
        !callFound ||
        resultFound ||
        message.toolName !== 'ask_user' ||
        message.isError ||
        message.content.length !== 1
      )
        throw new Error('Question transcript result binding differs')
      const content = message.content[0]
      if (content?.type !== 'text' || !isDeepStrictEqual(JSON.parse(content.text), expected))
        throw new Error('Question transcript answer differs')
      resultFound = true
    }
  }
  if (!callFound || !resultFound)
    throw new Error('Question outcome has not been persisted in its conversation')
}
