import type { ConversationUsage } from './usage.ts'

/** Conversation metadata. Pi's session file `<id>.jsonl` holds the transcript. */
export interface Conversation {
  id: string
  agentId: string
  title: string
  createdAt: number
  updatedAt: number
}

export interface ConversationListResponse {
  conversations: Conversation[]
  /** The conversation new turns write to; null before the Agent's first turn. */
  selectedId: string | null
  total: number
  offset: number
  limit: number
  /** What each listed conversation used, by id; one no model call was made in is left out. */
  usage: Record<string, ConversationUsage>
}

/** A message holding every word searched for, in what a conversation shows. */
export interface ConversationSearchHit {
  agentId: string
  agentName: string
  teamId: string
  teamName: string
  archived: boolean
  conversationId: string
  conversationTitle: string
  /** The conversation new turns write to. */
  active: boolean
  role: 'user' | 'assistant'
  /** When the message was written, if the history says. */
  at: number | null
  /** The message around the first word found, on one line. */
  snippet: string
  /** Which of its conversation's matching messages it is, oldest first, from 0. */
  nth: number
}

export interface ConversationSearchResponse {
  /** The words looked for, lower-cased. */
  words: string[]
  /** Newest first. */
  hits: ConversationSearchHit[]
  /** More messages matched than were returned. */
  truncated: boolean
  /** Conversations whose history could not be read, and so were not searched. */
  unreadable: number
}

export interface NewConversationInput {
  title?: string
}

/** The conversation a turn writes to, passed to the worker. Its transcript is `<id>.jsonl`. */
export interface ConversationTarget {
  id: string
}
