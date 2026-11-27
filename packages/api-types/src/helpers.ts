/**
 * A helper (BAZ-092): a short run of the same Agent for one task, started with `helper_start`
 * beside the Agent's own turn, in a conversation of its own. It ends with its answer.
 */
export interface Helper {
  id: string
  agentId: string
  /** The conversation it was started from. */
  parentConversationId: string
  /** Its own conversation, kept with the Agent's sessions. */
  conversationId: string
  task: string
  /** `provider:model` when not the Agent's own. */
  model: string | null
  status: 'running' | 'done' | 'failed' | 'stopped'
  /** What it is doing now, in a few words. */
  activity: string
  /** Its last message, once done. */
  answer: string | null
  error: string | null
  /** Who stopped it: the Agent (`helper_stop`), you, or the turn that started it ending stopped. */
  stoppedBy: 'agent' | 'owner' | 'turn' | null
  startedAt: number
  endedAt: number | null
}

export interface ListHelpersResponse {
  helpers: Helper[]
}

export interface StopHelperResponse {
  helper: Helper
}
