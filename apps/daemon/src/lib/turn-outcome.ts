import type { ChatFrame } from '@bazilion/api-types'

/**
 * Return the turn-level failure carried by a frame, if any.
 *
 * Pi reports provider failures as a normal `event:error` followed by `done`,
 * while worker/process failures use `fatal`. Tool errors are deliberately not
 * included: the model can observe and recover from those within a successful
 * turn.
 */
export function turnFrameFailure(frame: ChatFrame): string | null {
  if (frame.kind === 'fatal') return frame.error
  if (frame.kind === 'event' && frame.event.type === 'error') return frame.event.error
  return null
}

/**
 * A turn's failure as the owner reads it later (trigger history, the follow-up queue, a learning
 * review): the real reason on one line, at most 500 characters. Frames are already redacted for
 * the turn's credentials.
 */
export function turnFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message === 'cancelled') return 'Agent turn cancelled.'
  return message.replace(/\s+/g, ' ').trim().slice(0, 500) || 'Agent turn failed.'
}
