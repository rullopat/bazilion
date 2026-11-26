import type { Message } from '@bazilion/api-types'
import { DomainError } from '../core/errors.ts'
import { agentRepo, type BazilionDb, mayMessage, messageRepo } from '../core/index.ts'
import { ExchangeStoppedError, guardExchange, resolveMessageCausality } from './agent-loop-guard.ts'

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

/** Send one Agent-to-Agent message after its exchange and Team Policy allow it. */
export function sendAgentMessage(db: BazilionDb, input: SendAgentMessageInput): Message {
  const outcome = db.raw.transaction(
    (): {
      message?: Message
      denied?: string
      refused?: 'repeated_message' | 'stopped'
    } => {
      const causality = resolveMessageCausality(db, input)
      // A refusal for repetition is recorded, so the transaction ends normally.
      const refused = guardExchange(db, {
        from: input.from,
        to: input.to,
        payload: input.payload,
        origin: input.origin,
        causality,
      })
      if (refused) return { refused }
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
  if (outcome.refused) {
    throw new ExchangeStoppedError(outcome.refused, agentRepo.get(db, input.to)?.name ?? input.to)
  }
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
