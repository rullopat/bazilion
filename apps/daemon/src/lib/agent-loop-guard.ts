import { randomUUID } from 'node:crypto'
import type { AgentLoopBreakEvent, Message } from '@bazilion/api-types'
import { agentRepo, type BazilionDb, messageRepo, openConfig } from '../core/index.ts'

const DEFAULT_MAX_HOPS = 8

interface RawBreakEvent {
  id: string
  causal_chain_id: string
  parent_message_id: string | null
  from_agent_id: string
  to_agent_id: string
  source_team_id: string
  target_team_id: string
  attempted_hop: number
  max_hops: number
  reason: string
  origin: string
  created_at: number
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
    attemptedHop: row.attempted_hop,
    maxHops: row.max_hops,
    reason: row.reason,
    origin: row.origin,
    createdAt: row.created_at,
  }
}

export function agentLoopMaxHops(db?: BazilionDb, env: NodeJS.ProcessEnv = process.env): number {
  const raw =
    env.BAZILION_AGENT_LOOP_MAX_HOPS ??
    (db ? openConfig(db).get('BAZILION_AGENT_LOOP_MAX_HOPS') : undefined)
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_MAX_HOPS
}

export class AgentLoopLimitError extends Error {
  constructor(readonly event: AgentLoopBreakEvent) {
    super(
      `agent message chain ${event.causalChainId} stopped at hop ${event.attemptedHop} ` +
        `(limit ${event.maxHops})`,
    )
    this.name = 'AgentLoopLimitError'
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

export function enforceMessageCausality(
  db: BazilionDb,
  input: {
    from: string
    to: string
    origin: string
    causality: MessageCausality
  },
): AgentLoopBreakEvent | null {
  const attemptedHop = input.causality.causalHop ?? 0
  const maxHops = agentLoopMaxHops(db)
  if (attemptedHop <= maxHops) return null
  const source = agentRepo.get(db, input.from)
  const target = agentRepo.get(db, input.to)
  if (!source || !target) return null
  const event: AgentLoopBreakEvent = {
    id: randomUUID(),
    causalChainId: input.causality.causalChainId ?? input.causality.parentMessageId ?? randomUUID(),
    parentMessageId: input.causality.parentMessageId,
    fromAgentId: input.from,
    toAgentId: input.to,
    sourceTeamId: source.teamId,
    targetTeamId: target.teamId,
    attemptedHop,
    maxHops,
    reason: 'causal_hop_limit_exceeded',
    origin: input.origin,
    createdAt: Date.now(),
  }
  db.raw.run(
    `INSERT INTO agent_loop_break_events
       (id, causal_chain_id, parent_message_id, from_agent_id, to_agent_id,
        source_team_id, target_team_id, attempted_hop, max_hops, reason, origin, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.id,
      event.causalChainId,
      event.parentMessageId,
      event.fromAgentId,
      event.toAgentId,
      event.sourceTeamId,
      event.targetTeamId,
      event.attemptedHop,
      event.maxHops,
      event.reason,
      event.origin,
      event.createdAt,
    ],
  )
  return event
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
