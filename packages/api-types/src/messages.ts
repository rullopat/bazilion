import type { AgentLoopBreakEvent, Message } from './entities.ts'

export interface SendMessageRequest {
  from: string
  payload: { text: string }
  replyTo?: string
}

export interface ListInboxResponse {
  messages: Message[]
}

export interface ListAgentLoopBreaksResponse {
  events: AgentLoopBreakEvent[]
}

export interface UpdateMessageRequest {
  read: true
}
