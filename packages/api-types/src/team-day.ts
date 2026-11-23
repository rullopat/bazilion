// A Team's day (`GET /api/teams/:id/today`): what its Agents handed to each other, delivered,
// worked on and wait on you for, newest first, so a lead's delegated work can be followed without
// opening every Agent.

export type TeamDayKind = 'handoff' | 'reply' | 'file' | 'worked' | 'question' | 'approval'

export interface TeamDayEvent {
  at: number
  kind: TeamDayKind
  /** Who did it: the sender, the Agent that delivered, worked or asks. */
  agentId: string
  agentName: string
  /** For a hand-off or a reply: who it went to. */
  otherAgentId?: string
  otherAgentName?: string
  /** One line: the message, the file's name, the conversation's title, the question. */
  text: string
  /** Where it is: the conversation worked in, the delivered file. */
  conversationId?: string
  resultId?: string
}

export interface TeamDayResponse {
  teamId: string
  /** The start of the day asked for (epoch ms). */
  since: number
  events: TeamDayEvent[]
  /** More happened than the list holds. */
  truncated: boolean
}

/** The text of an Agent-to-Agent message payload (`{ "text": … }`), or the payload as it is. */
export function messageText(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as { text?: unknown }
    if (parsed && typeof parsed.text === 'string') return parsed.text
  } catch {
    // Not JSON: the payload is the text.
  }
  return payload
}
