import type { ConversationTarget, ResolvedAgent } from '@bazilion/api-types'
import type { Paths } from '../core/paths.ts'
import { loadSessionHead } from '../runtime/pi/session.ts'
import { readResultSession } from './result-source.ts'

/** Pin the admission head. A child can name only a tool call appended during this turn. */
export function createTurnToolSource(
  paths: Paths,
  agent: ResolvedAgent,
  conversation: ConversationTarget,
  name: string,
) {
  const initialHead = loadSessionHead(agent, paths, conversation)
  return (sessionId: string, toolCallId: string): Record<string, unknown> => {
    if (sessionId !== conversation.id || !/^[A-Za-z0-9._:-]{1,256}$/.test(toolCallId)) {
      throw new Error('Tool source does not match admitted conversation')
    }
    const head = loadSessionHead(agent, paths, conversation)
    if (!head.file || head.size > 64 * 1024 * 1024) {
      throw new Error('Tool source session is unavailable or too large')
    }
    const entries = readResultSession(
      paths,
      agent.agent.id,
      head.file,
      sessionId,
      initialHead.file === head.file ? initialHead.size : 0,
    )
    for (const entry of entries) {
      if (entry.type !== 'message' || entry.message?.role !== 'assistant') continue
      for (const block of entry.message.content) {
        if (block.type === 'toolCall' && block.id === toolCallId && block.name === name) {
          return block.arguments
        }
      }
    }
    throw new Error('Tool call is not in this turn of the canonical transcript')
  }
}
