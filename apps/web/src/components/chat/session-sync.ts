// How a chat tells that its conversation moved without it: the conversation file's head, the
// follow-up queue and the live feed's activity readings, compared with what the tab last saw.

import type { AgentActivity, SessionHeadResponse, UserQueueListResponse } from '@bazilion/api-types'

export const EMPTY_HEAD: SessionHeadResponse = { file: null, size: 0, conversationId: null }

/** Follow-ups that wait or run. */
export function openFollowUps(queue: UserQueueListResponse | null): number {
  return (
    queue?.items.filter((item) => item.status === 'pending' || item.status === 'running').length ??
    0
  )
}

/** A turn runs, or a follow-up runs or is about to. */
export function isQueueWorking(queue: UserQueueListResponse | null) {
  return (
    queue?.turnActive ||
    queue?.items.some(
      (item) => item.status === 'running' || (item.status === 'pending' && !queue.paused),
    )
  )
}

/** The conversation file is not the one `known` describes: another source wrote to it. */
export function headMoved(head: SessionHeadResponse, known: SessionHeadResponse): boolean {
  return (
    Boolean(head.unavailable) !== Boolean(known.unavailable) ||
    head.file !== known.file ||
    head.size !== known.size
  )
}

/**
 * What a new activity reading of the Agent asks of the chat: look at the conversation's head, read
 * the queue again, read the queue and then look at the head when that did not reload the history
 * (a turn ended), or nothing.
 */
export function activityReaction(
  was: AgentActivity | null,
  now: AgentActivity,
): 'head' | 'queue' | 'queue-then-head' | null {
  // The first reading: anything that moved since the page was rendered shows now.
  if (!was) return 'head'
  if (
    now.working !== was.working ||
    now.queuePaused !== was.queuePaused ||
    now.followUps !== was.followUps
  ) {
    return was.working && !now.working ? 'queue-then-head' : 'queue'
  }
  if (!now.working && now.lastActivityAt !== was.lastActivityAt) return 'head'
  return null
}
