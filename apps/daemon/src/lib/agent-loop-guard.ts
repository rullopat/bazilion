// Messages between Agents form exchanges: the first message, sent in a turn someone started, opens
// one, and every message sent in a turn its messages woke continues it, one step further. An
// exchange has no length limit; it ends when its Agents stop writing. Two things stop it:
//
// - a message its sender already sent the same Agent in the exchange (the same words, whatever
//   the case, punctuation and spacing): the Agents are going round in circles, so it is not
//   delivered, and the sender is told to report to the user instead;
// - the user stopping it, from the Connections tab or the CLI.
//
// Each stop is kept in agent_loop_break_events, which Attention and the mailbox read.

import { randomUUID } from 'node:crypto'
import type { AgentLoopBreakEvent, ExchangeStopReason, Message } from '@bazilion/api-types'
import { DomainError } from '../core/errors.ts'
import { agentRepo, type BazilionDb, messageRepo } from '../core/index.ts'

interface RawBreakEvent {
  id: string
  causal_chain_id: string
  parent_message_id: string | null
  from_agent_id: string
  to_agent_id: string
  source_team_id: string
  target_team_id: string
  attempted_hop: number
  reason: string
  origin: string
  created_at: number
}

/** The stored reason as the API says it; a stop by the step limit of 0.61 and earlier is kept. */
function reasonOf(stored: string): ExchangeStopReason {
  if (stored === 'repeated_message' || stored === 'stopped') return stored
  return 'step_limit'
}

function toEvent(row: RawBreakEvent): AgentLoopBreakEvent {
  return {
    id: row.id,
    causalChainId: row.causal_chain_id,
    parentMessageId: row.parent_message_id,
    fromAgentId: row.from_agent_id,
    toAgentId: row.to_agent_id,
    sourceTeamId: row.source_team_id,
    targetTeamId: row.target_team_id,
    step: row.attempted_hop,
    reason: reasonOf(row.reason),
    origin: row.origin,
    createdAt: row.created_at,
  }
}

/** A message the exchange refused; its words are for the Agent that sent it. */
export class ExchangeStoppedError extends DomainError {
  constructor(reason: 'repeated_message' | 'stopped', recipient: string) {
    super(
      409,
      reason === 'repeated_message'
        ? `Not delivered: you already sent ${recipient} this same message in this exchange, so you are going round in circles. Do not send it again: tell the user in a few lines where the work stands and what is missing.`
        : 'Not delivered: the user stopped this exchange between Agents. Do not message about it again: tell the user in a few lines where the work stands.',
      reason === 'repeated_message' ? 'exchange_repeated_message' : 'exchange_stopped',
    )
  }
}

export type MessageCausality = {
  causalChainId?: string
  causalHop?: number
  parentMessageId: string | null
}

export function resolveMessageCausality(
  db: BazilionDb,
  input: { replyTo?: string | null; causalParentMessageId?: string | null },
): MessageCausality {
  const parentMessageId = input.replyTo ?? input.causalParentMessageId ?? null
  if (!parentMessageId) return { parentMessageId: null }
  const parent = messageRepo.get(db, parentMessageId)
  if (!parent) return { parentMessageId: null }
  return {
    causalChainId: parent.causalChainId,
    causalHop: parent.causalHop + 1,
    parentMessageId: parent.id,
  }
}

/** A message's words as compared for repetition: case, punctuation and spacing aside. */
export function sameWords(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Whether the user stopped this exchange. */
export function isStoppedExchange(db: BazilionDb, chainId: string): boolean {
  return (
    db.raw
      .query<{ one: number }, [string]>(
        `SELECT 1 one FROM agent_loop_break_events WHERE causal_chain_id = ? AND reason = 'stopped' LIMIT 1`,
      )
      .get(chainId) !== null
  )
}

function recordStop(
  db: BazilionDb,
  event: Omit<AgentLoopBreakEvent, 'id' | 'createdAt' | 'sourceTeamId' | 'targetTeamId'>,
): AgentLoopBreakEvent | null {
  const source = agentRepo.get(db, event.fromAgentId)
  const target = agentRepo.get(db, event.toAgentId)
  if (!source || !target) return null
  const stored: AgentLoopBreakEvent = {
    ...event,
    id: randomUUID(),
    sourceTeamId: source.teamId,
    targetTeamId: target.teamId,
    createdAt: Date.now(),
  }
  db.raw.run(
    `INSERT INTO agent_loop_break_events
       (id, causal_chain_id, parent_message_id, from_agent_id, to_agent_id,
        source_team_id, target_team_id, attempted_hop, max_hops, reason, origin, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [
      stored.id,
      stored.causalChainId,
      stored.parentMessageId,
      stored.fromAgentId,
      stored.toAgentId,
      stored.sourceTeamId,
      stored.targetTeamId,
      stored.step,
      stored.reason,
      stored.origin,
      stored.createdAt,
    ],
  )
  return stored
}

/**
 * Refuse a message that continues an exchange the user stopped, or that repeats a message its
 * sender already sent the same Agent in the exchange (that refusal is recorded). A message that
 * opens an exchange is never refused here.
 */
export function guardExchange(
  db: BazilionDb,
  input: { from: string; to: string; payload: string; origin: string; causality: MessageCausality },
): 'repeated_message' | 'stopped' | null {
  const chainId = input.causality.causalChainId
  if (!chainId) return null
  if (isStoppedExchange(db, chainId)) return 'stopped'
  const words = sameWords(messageRepo.messageText(input.payload))
  const repeated = messageRepo
    .listExchange(db, chainId)
    .some(
      (message) =>
        message.fromAgentId === input.from &&
        message.toAgentId === input.to &&
        sameWords(messageRepo.messageText(message.payload)) === words,
    )
  if (!repeated) return null
  recordStop(db, {
    causalChainId: chainId,
    parentMessageId: input.causality.parentMessageId,
    fromAgentId: input.from,
    toAgentId: input.to,
    step: input.causality.causalHop ?? 0,
    reason: 'repeated_message',
    origin: input.origin,
  })
  return 'repeated_message'
}

/** Record that the user stopped an exchange; false when it has no message or was stopped. */
export function recordExchangeStop(db: BazilionDb, chainId: string): boolean {
  const messages = messageRepo.listExchange(db, chainId)
  const first = messages[0]
  const last = messages.at(-1)
  if (!first || !last || isStoppedExchange(db, chainId)) return false
  return (
    recordStop(db, {
      causalChainId: chainId,
      parentMessageId: last.id,
      fromAgentId: first.fromAgentId,
      toAgentId: first.toAgentId,
      step: last.causalHop,
      reason: 'stopped',
      origin: 'operator',
    }) !== null
  )
}

export function listAgentLoopBreaks(
  db: BazilionDb,
  agentId: string,
  limit = 50,
): AgentLoopBreakEvent[] {
  return db.raw
    .query<RawBreakEvent, [string, string, number]>(
      `SELECT * FROM agent_loop_break_events
       WHERE from_agent_id = ? OR to_agent_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(agentId, agentId, Math.max(1, Math.min(limit, 100)))
    .map(toEvent)
}

export function selectCausalParent(messages: Message[]): string | null {
  let selected: Message | undefined
  for (const message of messages) {
    if (!selected || message.causalHop > selected.causalHop) selected = message
  }
  return selected?.id ?? null
}
