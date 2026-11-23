// Opening a conversation from a search result: scroll to the first message holding every word
// searched for, and mark it for a moment. Messages arrive after the page opens, so the transcript
// is watched until one matches or a few seconds pass.

import { type RefObject, useEffect, useRef } from 'react'

const GIVE_UP_MS = 8_000
const MARK_MS = 2_500

/**
 * The `nth` element marked `data-message` whose text holds every word (oldest first, from 0), or
 * the last one that does when there are fewer.
 */
export function findMessage(root: ParentNode, find: string, nth = 0): HTMLElement | null {
  const words = find.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return null
  const found: HTMLElement[] = []
  for (const element of root.querySelectorAll<HTMLElement>('[data-message]')) {
    const text = (element.textContent ?? '').toLowerCase()
    if (words.every((word) => text.includes(word))) found.push(element)
  }
  return found[Math.min(nth, found.length - 1)] ?? null
}

/**
 * Scroll to the message `find` and `nth` name, then call `done` (found or not) to drop them from
 * the address. `done` is the latest one passed: what was opened meanwhile stays open.
 */
export function useFindInTranscript(
  container: RefObject<HTMLElement | null>,
  find: string | undefined,
  nth: number | undefined,
  done: () => void,
): void {
  const latest = useRef(done)
  latest.current = done
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per search.
  useEffect(() => {
    const root = container.current
    if (!find || !root) return
    let finished = false
    const finish = () => {
      finished = true
      observer.disconnect()
      window.clearTimeout(giveUp)
      latest.current()
    }
    const look = () => {
      if (finished) return
      const found = findMessage(root, find, nth)
      if (!found) return
      found.scrollIntoView({ block: 'center' })
      found.classList.add('found-message')
      window.setTimeout(() => found.classList.remove('found-message'), MARK_MS)
      finish()
    }
    const observer = new MutationObserver(look)
    observer.observe(root, { childList: true, subtree: true })
    const giveUp = window.setTimeout(finish, GIVE_UP_MS)
    look()
    return () => {
      finished = true
      observer.disconnect()
      window.clearTimeout(giveUp)
    }
  }, [find, nth])
}
