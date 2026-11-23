// Opening a conversation from a search result: scroll to the first message holding every word
// searched for, and mark it for a moment. Messages arrive after the page opens, so the transcript
// is watched until one matches or a few seconds pass.

import { type RefObject, useEffect } from 'react'

const GIVE_UP_MS = 8_000
const MARK_MS = 2_500

/** The first element marked `data-message` whose text holds every word. */
export function findMessage(root: ParentNode, find: string): HTMLElement | null {
  const words = find.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return null
  for (const element of root.querySelectorAll<HTMLElement>('[data-message]')) {
    const text = (element.textContent ?? '').toLowerCase()
    if (words.every((word) => text.includes(word))) return element
  }
  return null
}

/** Scroll to the message `find` names, then call `done` (found or not) to drop it from the URL. */
export function useFindInTranscript(
  container: RefObject<HTMLElement | null>,
  find: string | undefined,
  done: () => void,
): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per search; `done` changes every render.
  useEffect(() => {
    const root = container.current
    if (!find || !root) return
    let finished = false
    const finish = () => {
      finished = true
      observer.disconnect()
      window.clearTimeout(giveUp)
      done()
    }
    const look = () => {
      if (finished) return
      const found = findMessage(root, find)
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
  }, [find])
}
