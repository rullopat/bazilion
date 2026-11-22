// Desktop notifications: when an Agent starts waiting for the operator (a question, a command to
// approve) and no Bazilion tab of this browser has the focus, the browser shows a notification;
// clicking it opens the Agent's conversation. Off until turned on from the session menu, which
// asks the browser's permission. The choice is kept in this browser only.

import type { AttentionItem } from '@bazilion/api-types'
import { useRouter } from '@tanstack/react-router'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useLive } from './live'

const KEY = 'bz_notify'
const CHANGED = 'bz-notify-change'
/** A burst (several Agents at once) shows at most this many notifications. */
const MAX_AT_ONCE = 3

export type NotificationsState =
  /** The browser has no notifications here (an http:// address other than this computer). */
  | 'unsupported'
  /** The browser refuses them for this site; only its site settings can change that. */
  | 'blocked'
  | 'off'
  | 'on'

function read(): NotificationsState {
  if (typeof window === 'undefined' || !('Notification' in window) || !window.isSecureContext)
    return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  let chosen = false
  try {
    chosen = window.localStorage.getItem(KEY) === 'on'
  } catch {
    chosen = false
  }
  return chosen && Notification.permission === 'granted' ? 'on' : 'off'
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(CHANGED, onChange)
    window.removeEventListener('storage', onChange)
  }
}

function store(value: 'on' | 'off'): void {
  try {
    window.localStorage.setItem(KEY, value)
  } catch {
    // Storage is unavailable: the choice lasts for this page only.
  }
  window.dispatchEvent(new Event(CHANGED))
}

/** Whether desktop notifications are on in this browser; the server renders "off". */
export function useNotificationsState(): NotificationsState {
  return useSyncExternalStore(subscribe, read, () => 'off')
}

/** Ask the browser's permission (it must follow a click) and turn notifications on if granted. */
export async function turnNotificationsOn(): Promise<NotificationsState> {
  if (read() === 'unsupported') return 'unsupported'
  const permission =
    Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  store(permission === 'granted' ? 'on' : 'off')
  return read()
}

export function turnNotificationsOff(): void {
  store('off')
}

/** The items that started waiting since `known`, oldest first, at most a few. */
export function newlyWaiting(
  known: ReadonlySet<string>,
  waiting: readonly AttentionItem[],
): AttentionItem[] {
  return waiting
    .filter((item) => !known.has(item.key))
    .toSorted((a, b) => a.occurredAt - b.occurredAt)
    .slice(0, MAX_AT_ONCE)
}

/** Shows the notifications; rendered once, inside the live feed's provider. */
export function DesktopNotifier() {
  const live = useLive()
  const router = useRouter()
  const known = useRef<Set<string> | null>(null)

  useEffect(
    () =>
      live.subscribe('attention', (event) => {
        const first = known.current === null
        const fresh = first ? [] : newlyWaiting(known.current ?? new Set(), event.waiting)
        // What already waited when the page opened is on screen; only later arrivals notify.
        known.current = new Set(event.waiting.map((item) => item.key))
        if (fresh.length === 0 || read() !== 'on') return
        // One tab notifies, and only when the operator is not looking at Bazilion.
        if (!live.isLeader() || live.anyTabFocused()) return
        for (const item of fresh) {
          let notification: Notification
          try {
            notification = new Notification(item.title, {
              body: item.diagnostic,
              tag: item.key,
              icon: '/baziu.svg',
            })
          } catch {
            // Some browsers (Chrome on Android) show notifications only from a service worker.
            return
          }
          notification.onclick = () => {
            window.focus()
            notification.close()
            void router.navigate({ href: item.href })
          }
        }
      }),
    [live.subscribe, live.isLeader, live.anyTabFocused, router],
  )
  return null
}
