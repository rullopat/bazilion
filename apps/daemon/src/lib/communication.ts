import type { AgentLoopBreakEvent, Message } from '@bazilion/api-types'
import { DomainError } from '../core/errors.ts'
import { type BazilionDb, mayMessage, messageRepo } from '../core/index.ts'
import {
  AgentLoopLimitError,
  enforceMessageCausality,
  resolveMessageCausality,
} from './agent-loop-guard.ts'

/** A message Team Policy does not allow; the reason goes back to the tool or HTTP caller. */
export class CommunicationDeniedError extends DomainError {
  constructor(reason: string) {
    super(403, `Team Policy denied this message: ${reason}`, 'communication_denied')
  }
}

export interface SendAgentMessageInput {
  from: string
  to: string
  payload: string
  replyTo?: string | null
  causalParentMessageId?: string | null
  origin: string
}

/** Send one Agent-to-Agent message after the loop guard and Team Policy allow it. */
export function sendAgentMessage(db: BazilionDb, input: SendAgentMessageInput): Message {
  const outcome = db.raw.transaction(
    (): { message?: Message; denied?: string; loopBreak?: AgentLoopBreakEvent } => {
      const causality = resolveMessageCausality(db, input)
      const loopBreak = enforceMessageCausality(db, {
        from: input.from,
        to: input.to,
        origin: input.origin,
        causality,
      })
      if (loopBreak) return { loopBreak }
      const decision = mayMessage(db, input.from, input.to)
      if (!decision.allowed) return { denied: decision.reason }
      return {
        message: messageRepo.send(db, {
          ...input,
          causalChainId: causality.causalChainId,
          causalHop: causality.causalHop,
        }),
      }
    },
  )()
  if (outcome.loopBreak) throw new AgentLoopLimitError(outcome.loopBreak)
  if (outcome.denied !== undefined) {
    console.warn(
      JSON.stringify({
        event: 'team_policy_denied',
        from: input.from,
        to: input.to,
        origin: input.origin,
        reason: outcome.denied,
      }),
    )
    throw new CommunicationDeniedError(outcome.denied)
  }
  if (!outcome.message) throw new Error('communication transaction produced no result')
  return outcome.message
}
