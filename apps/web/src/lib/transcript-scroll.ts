// Where the reader was in a conversation, so going to another Agent and back opens it there. The
// place is the first message in view and how far its top was from the top of the view: unlike a
// pixel offset, it holds when messages above it render to another height. Kept for this page
// only: a reload opens every conversation at its end, as before.

import { type RefObject, useEffect, useId, useLayoutEffect, useRef } from 'react'

/** A reader at the end follows new output; otherwise they are at a message. */
export type TranscriptPlace = { atEnd: true } | { atEnd: false; index: number; offset: number }

const MESSAGE = '[data-message]'
/** Closer than this to the end counts as at the end. */
export const AT_END_PX = 40
/** Enough for every conversation one sitting opens; the oldest place is dropped past it. */
const KEEP = 200

const places = new Map<string, TranscriptPlace>()

export function placeKey(agentId: string, conversationId: string | null): string {
  return `${agentId}:${conversationId ?? ''}`
}

export function isAtEnd(log: HTMLElement): boolean {
  return log.scrollHeight - log.scrollTop - log.clientHeight < AT_END_PX
}

/** Where the reader is in `log`. */
export function readPlace(log: HTMLElement): TranscriptPlace {
  if (isAtEnd(log)) return { atEnd: true }
  const top = log.getBoundingClientRect().top
  const messages = log.querySelectorAll<HTMLElement>(MESSAGE)
  for (let index = 0; index < messages.length; index++) {
    const box = messages[index]?.getBoundingClientRect()
    if (box && box.bottom > top) return { atEnd: false, index, offset: box.top - top }
  }
  return { atEnd: true }
}

/** Put `log` back at `place`; false when the message it names is not there. */
export function applyPlace(log: HTMLElement, place: TranscriptPlace): boolean {
  if (place.atEnd) {
    log.scrollTop = log.scrollHeight
    return true
  }
  const message = log.querySelectorAll<HTMLElement>(MESSAGE)[place.index]
  if (!message) return false
  const top = log.getBoundingClientRect().top
  log.scrollTop += message.getBoundingClientRect().top - top - place.offset
  return true
}

export function rememberPlace(key: string, place: TranscriptPlace): void {
  places.delete(key)
  places.set(key, place)
  if (places.size > KEEP) {
    const oldest = places.keys().next().value
    if (oldest !== undefined) places.delete(oldest)
  }
}

export function rememberedPlace(key: string): TranscriptPlace | undefined {
  return places.get(key)
}

/** What the log element takes from `useTranscriptPlace`. */
export interface TranscriptLogProps {
  'data-scroll-restoration-id': string
}

/**
 * Remember where the reader is in `log`, under `key()` as it is when they scroll, and put them
 * back there once `ready` (the messages are on screen), unless `skip` (a search result opens the
 * conversation at its message instead). `onRestored` hears of a place put back that is not the
 * end, so the caller stops following new output. Call it before the effect that follows the end,
 * and spread what it returns on the log.
 *
 * The router keeps the pixel offset of every element it saw scroll, by its id or else by where it
 * stands in the page, and puts it back after each navigation, after this hook has. Every
 * conversation stands in the same place, so one Agent's offset would land on the next one's log.
 * An id of this log's own, new for every pane, means the router never finds it again.
 */
export function useTranscriptPlace(
  log: RefObject<HTMLElement | null>,
  key: () => string,
  { ready, skip, onRestored }: { ready: boolean; skip: boolean; onRestored?: () => void },
): TranscriptLogProps {
  const id = useId()
  const keyRef = useRef(key)
  keyRef.current = key
  const restored = useRef(false)

  useLayoutEffect(() => {
    const element = log.current
    if (restored.current || !ready || !element) return
    restored.current = true
    if (skip) return
    const place = rememberedPlace(keyRef.current())
    if (place && applyPlace(element, place) && !place.atEnd) onRestored?.()
  })

  // A place still to be saved when the conversation goes (another Agent clicked during a
  // scroll) is saved before the log leaves the page, while it can still be measured.
  const pending = useRef(0)
  const saveNow = useRef(() => {})
  // biome-ignore lint/correctness/useExhaustiveDependencies: the log element lives as long as the caller.
  useEffect(() => {
    const element = log.current
    if (!element) return
    saveNow.current = () => {
      pending.current = 0
      if (element.isConnected) rememberPlace(keyRef.current(), readPlace(element))
    }
    const onScroll = () => {
      // Only scrolling the reader did, or the end being followed, counts: not the first layout.
      if (!restored.current) return
      pending.current ||= window.requestAnimationFrame(() => saveNow.current())
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  }, [])
  useLayoutEffect(
    () => () => {
      if (!pending.current) return
      window.cancelAnimationFrame(pending.current)
      saveNow.current()
    },
    [],
  )
  return { 'data-scroll-restoration-id': `conversation${id}` }
}
