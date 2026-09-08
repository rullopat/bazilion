import type { ConversationSelection } from './conversations.ts'
import type { Attachment } from './index.ts'

export type UserQueueStatus =
  | 'pending'
  | 'claimed'
  | 'running'
  | 'held'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'uncertain'
  | 'superseded'
export interface QueueAttachment {
  id: string
  name: string | null
  mimeType: string
  byteLength: number
  sha256: string
}
export interface UserQueueItem {
  id: string
  agentId: string
  teamId: string
  conversationId: string
  source: 'http' | 'telegram'
  attemptId: string
  revision: number
  position: number
  status: UserQueueStatus
  text: string | null
  attachments: QueueAttachment[]
  payloadRetained: boolean
  supersedesId: string | null
  approvalId: string | null
  diagnostic: string | null
  createdAt: number
  updatedAt: number
  startedAt: number | null
  finishedAt: number | null
}
export interface UserQueueControl {
  paused: boolean
  revision: number
  reason: string | null
}
export interface UserQueueListResponse {
  items: UserQueueItem[]
  control: UserQueueControl
  total: number
  offset: number
  limit: number
}
export interface EnqueueUserInput {
  requestId: string
  expectedSelection: ConversationSelection
  message: string
  attachments?: Attachment[]
}
export interface EditQueuedInput extends EnqueueUserInput {
  expectedRevision: number
}
