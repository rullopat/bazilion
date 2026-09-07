import type { ResolvedAgent } from '@bazilion/api-types'
import type { BazilionDb, Paths } from '../core/index.ts'
import * as results from '../core/repos/results.ts'
import { loadSessionHead } from '../runtime/pi/session.ts'
import type { PublishResultArgs, ResultHost } from '../runtime/worker/ipc-protocol.ts'
import { reconcilePrivateResults } from './result-retention.ts'
import { readResultSession } from './result-source.ts'

/** A child may name its source operation, never its owning Agent, Team or storage path. */
export function createResultHost(
  db: BazilionDb,
  paths: Paths,
  agent: ResolvedAgent,
  signal: AbortSignal,
): ResultHost {
  const initialHead = loadSessionHead(agent, paths)
  return {
    async publish(input: PublishResultArgs) {
      signal.throwIfAborted()
      if (
        !input ||
        typeof input.sessionId !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(input.sessionId) ||
        typeof input.toolCallId !== 'string'
      ) {
        throw new Error('Invalid result source operation')
      }
      if (
        typeof input.data !== 'string' ||
        input.data.length > Math.ceil(results.MAX_RESULT_BYTES / 3) * 4 ||
        input.data.length % 4 !== 0
      ) {
        throw new Error('Invalid or oversized result bytes')
      }
      const bytes = Buffer.from(input.data, 'base64')
      if (bytes.byteLength > results.MAX_RESULT_BYTES || bytes.toString('base64') !== input.data) {
        throw new Error('Invalid or oversized result bytes')
      }
      const head = loadSessionHead(agent, paths)
      if (!head.file || head.size > 64 * 1024 * 1024)
        throw new Error('Result source session is unavailable or too large')
      const entries = readResultSession(
        paths,
        agent.agent.id,
        head.file,
        input.sessionId,
        initialHead.file === head.file ? initialHead.size : 0,
      )
      const matches = entries.some((entry) => {
        const message = entry.type === 'message' ? entry.message : undefined
        return (
          entry.type === 'message' &&
          message?.role === 'assistant' &&
          Array.isArray(message.content) &&
          message.content.some(
            (block) =>
              block.type === 'toolCall' &&
              block.id === input.toolCallId &&
              block.name === 'deliver_file',
          )
        )
      })
      if (!matches)
        throw new Error('Result source tool call is not in this turn of the canonical transcript')
      signal.throwIfAborted()
      reconcilePrivateResults(db, { excludeAgentId: agent.agent.id })
      const receipt = results.publish(db, {
        teamId: agent.team.id,
        agentId: agent.agent.id,
        sessionId: input.sessionId,
        toolCallId: input.toolCallId,
        name: input.name,
        mimeType: input.mimeType,
        bytes,
      })
      return { resultId: receipt.id }
    },
  }
}
