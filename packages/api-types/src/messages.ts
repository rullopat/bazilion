import type { AgentLoopBreakEvent, Message } from './entities.ts'

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

export interface ListAgentLoopBreaksResponse {
  events: AgentLoopBreakEvent[]
}

export interface UpdateMessageRequest {
  read: true
}
