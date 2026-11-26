import type { AgentLoopBreakEvent, Message } from './entities.ts'
import type { ConversationUsage } from './usage.ts'

export interface SendMessageRequest {
  from: string
  payload: { text: string }
  replyTo?: string
}

export interface ListInboxResponse {
  messages: Message[]
}

/** `GET /api/teams/:id/messages`: what the Team's Agents sent and received, newest first. */
export interface ListTeamMessagesResponse {
  messages: Message[]
}

/** `GET /api/agents/:id/loop-breaks`: the exchanges with the Agent in them that stopped. */
export interface ListAgentLoopBreaksResponse {
  events: AgentLoopBreakEvent[]
}

/**
 * An exchange between Agents going on now: a message waiting to wake its recipient, or a turn
 * one woke. It began with a message sent in a turn someone started; each message sent in a turn
 * its messages woke continued it.
 */
export interface ActiveExchange {
  id: string
  /** Its Agents, in the order they first wrote or were written to. */
  agentIds: string[]
  messages: number
  startedAt: number
  lastAt: number
  /** The Agents running a turn it woke. */
  runningAgentIds: string[]
  /** What the turns it woke have used, as Usage counts it. */
  used: ConversationUsage
}

/** `GET /api/teams/:id/exchanges`: the exchanges a Team's Agents are in now, latest first. */
export interface ListExchangesResponse {
  exchanges: ActiveExchange[]
}

/** `POST /api/exchanges/:id/stop`. */
export interface StopExchangeResponse {
  /** False when it had no message, or was stopped already. */
  stopped: boolean
  /** The Agents whose turn on it was stopped. */
  cancelled: string[]
  /** Its messages that were waiting to be read, and now wake no one. */
  unread: number
}

export interface UpdateMessageRequest {
  read: true
}
