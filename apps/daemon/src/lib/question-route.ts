import type { BazilionDb } from '../core/db/client.ts'
import * as approvals from '../core/repos/communicationApprovals.ts'
import * as queue from '../core/repos/user-queue.ts'
import {
  captureTelegramQueueBinding,
  requireTelegramQueuedTurn,
  type TelegramQueueBinding,
} from './telegram/queue-binding.ts'
import { assertTrustedTurnInvocation, type TrustedTurnInvocation } from './turn-invocation.ts'

export type QuestionResponseRoute =
  | { kind: 'web' | 'tty' }
  | { kind: 'telegram'; binding: TelegramQueueBinding }

/** Invoked only by final preparation, after verifying its nominal human invocation. */
export function resolveQuestionRoute(
  db: BazilionDb,
  authToken: string,
  invocation: TrustedTurnInvocation,
  mode?: 'web' | 'tty',
  queuedItemId?: string,
): QuestionResponseRoute | undefined {
  assertTrustedTurnInvocation(invocation)
  if (mode !== undefined) {
    if ((mode !== 'web' && mode !== 'tty') || invocation.kind !== 'operator_http' || queuedItemId) {
      throw new Error('Question response route is not eligible for this invocation')
    }
    return { kind: mode }
  }
  if (invocation.kind === 'telegram') {
    if (queuedItemId)
      return {
        kind: 'telegram',
        binding: requireTelegramQueuedTurn(
          db,
          authToken,
          queue.readInput(db, invocation.turn.agentId, queuedItemId).provenance,
          invocation.turn,
        ),
      }
    try {
      return {
        kind: 'telegram',
        binding: captureTelegramQueueBinding(db, authToken, invocation.authorization),
      }
    } catch {
      // Missing human response transport disables clarification; normal turn admission
      // and its protected prerequisites still have their independent checks.
      return undefined
    }
  }
  if (
    invocation.kind === 'approval_delivery' &&
    invocation.authorization.origin === 'telegram_agent_topic'
  ) {
    const approval = approvals.get(db, invocation.authorization.approvalId, true)
    if (
      !approval ||
      !('payload' in approval) ||
      approval.payloadKind !== 'queued_user' ||
      approval.status !== 'delivering'
    )
      return undefined
    const payload = approval.payload as { agentId?: unknown; itemId?: unknown }
    if (payload.agentId !== invocation.turn.agentId || typeof payload.itemId !== 'string')
      throw new Error('Question approval route binding changed')
    const retained = queue.readInput(db, invocation.turn.agentId, payload.itemId)
    if (
      retained.item.approvalId !== approval.id ||
      retained.item.status !== 'claimed' ||
      retained.item.attemptId !== invocation.authorization.attemptId
    )
      throw new Error('Question approved queue binding changed')
    return {
      kind: 'telegram',
      binding: requireTelegramQueuedTurn(db, authToken, retained.provenance, invocation.turn),
    }
  }
  return undefined
}
