import type { ResolvedAgent } from '@bazilion/api-types'
import type { BazilionDb } from '../core/index.ts'
import * as results from '../core/repos/results.ts'
import type { PublishResultArgs, ResultHost } from '../runtime/worker/ipc-protocol.ts'

/** deliver_file in the daemon: the turn fixes the Agent, Team and conversation; the worker names only its tool call. */
export function createResultHost(
  db: BazilionDb,
  agent: ResolvedAgent,
  conversationId: string,
  signal: AbortSignal,
): ResultHost {
  return {
    async publish(input: PublishResultArgs) {
      signal.throwIfAborted()
      if (
        typeof input?.data !== 'string' ||
        input.data.length > Math.ceil(results.MAX_RESULT_BYTES / 3) * 4
      )
        throw new Error('Result exceeds the 25 MiB per-file limit')
      const saved = results.publish(db, {
        teamId: agent.team.id,
        agentId: agent.agent.id,
        sessionId: conversationId,
        toolCallId: input.toolCallId,
        name: input.name,
        mimeType: input.mimeType,
        bytes: Buffer.from(input.data, 'base64'),
      })
      return { resultId: saved.id }
    },
    async show(resultId: string) {
      const saved = typeof resultId === 'string' ? results.get(db, resultId) : null
      if (!saved || saved.agentId !== agent.agent.id)
        throw new Error(`deliver_file: you have no saved result ${resultId}`)
      return { result: { resultId: saved.id }, name: saved.name, mimeType: saved.mimeType }
    },
    async read(resultId: string) {
      const saved = typeof resultId === 'string' ? results.get(db, resultId) : null
      if (!saved || saved.agentId !== agent.agent.id)
        throw new Error(`you have no saved result ${resultId}`)
      return {
        name: saved.name,
        mimeType: saved.mimeType,
        data: results.read(db, saved.id).toString('base64'),
      }
    },
  }
}
