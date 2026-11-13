import type { Attachment } from './chat.ts'

export type UserQueueStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface QueueAttachment {
  name: string | null
  mimeType: string
  byteLength: number
}

/** A follow-up: input that waits for the Agent's current turn and then runs as its own turn. */
export interface UserQueueItem {
  id: string
  agentId: string
  /** The conversation it was sent to, where it runs. */
  conversationId: string
  source: 'http' | 'telegram'
  status: UserQueueStatus
  text: string
  attachments: QueueAttachment[]
  /** Why it failed or was cancelled. */
  diagnostic: string | null
  createdAt: number
  updatedAt: number
  startedAt: number | null
  finishedAt: number | null
}

/** Waiting, running and failed follow-ups, oldest first. */
export interface UserQueueListResponse {
  /** A paused queue starts nothing until it is resumed. */
  paused: boolean
  /** The Agent is running a turn (a follow-up, a chat, Telegram or a schedule); Stop cancels it. */
  turnActive: boolean
  items: UserQueueItem[]
}

/** Queue a follow-up. Editing one (PATCH) replaces only its `message`. */
export interface EnqueueUserInput {
  message: string
  attachments?: Attachment[]
}
