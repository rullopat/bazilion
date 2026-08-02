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
