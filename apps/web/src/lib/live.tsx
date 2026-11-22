// The live feed (GET /api/events): what every Agent is doing and what is open in Attention,
// pushed by the daemon when it changes. One tab per browser holds the stream (a Web Lock picks
// it) and passes each event to the others over a BroadcastChannel, so many open tabs still use
// one connection. While no stream is up (`connected` false) readers ask on their own, as before.

import type { LiveEvent } from '@bazilion/api-types'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

const CHANNEL = 'bazilion-live'
const LOCK = 'bazilion-live'
const EVENT_TYPES: readonly LiveEvent['type'][] = ['activity', 'attention']
/** After a failed stream: wait, then try again, longer each time up to the last. */
const RETRY_MS = [1_000, 3_000, 10_000, 30_000]

type LiveOf<T extends LiveEvent['type']> = Extract<LiveEvent, { type: T }>
type Handler = (event: LiveEvent) => void

type Message =
  | { kind: 'event'; event: LiveEvent }
  | { kind: 'status'; connected: boolean }
  | { kind: 'hello' }
  | { kind: 'focus'; tab: string; focused: boolean }

interface LiveValue {
  /** Events arrive; while false, readers fall back to asking every few seconds. */
  connected: boolean
  /** Hear every event of one type; the latest one, if any, is passed at once. */
  subscribe<T extends LiveEvent['type']>(type: T, handler: (event: LiveOf<T>) => void): () => void
  /** This tab holds the stream: tab-wide duties (desktop notifications) happen here only. */
  isLeader(): boolean
  /** Some Bazilion tab of this browser has the focus. */
  anyTabFocused(): boolean
}

const LiveContext = createContext<LiveValue>({
  connected: false,
  subscribe: () => () => {},
  isLeader: () => false,
  anyTabFocused: () => true,
})

export function useLive(): LiveValue {
  return useContext(LiveContext)
}

/** Parse one SSE message's data; null for anything that is not a live event. */
export function parseLiveEvent(data: string): LiveEvent | null {
  try {
    const event = JSON.parse(data) as LiveEvent
    return event && EVENT_TYPES.includes(event.type) ? event : null
  } catch {
    return null
  }
}

export function LiveProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [connected, setConnected] = useState(false)
  const handlers = useRef(new Map<LiveEvent['type'], Set<Handler>>())
  const latest = useRef(new Map<LiveEvent['type'], LiveEvent>())
  const leading = useRef(false)
  const focusedTabs = useRef(new Set<string>())

  const deliver = useCallback((event: LiveEvent) => {
    latest.current.set(event.type, event)
    for (const handler of handlers.current.get(event.type) ?? []) handler(event)
  }, [])

  useEffect(() => {
    if (!enabled) return
    let stopped = false
    let source: EventSource | null = null
    let retry: number | undefined
    let failures = 0
    const tab = Math.random().toString(36).slice(2)
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL)
    const post = (message: Message) => channel?.postMessage(message)
    let releaseLock: () => void = () => {}

    const status = (value: boolean) => {
      setConnected(value)
      post({ kind: 'status', connected: value })
    }

    const open = () => {
      if (stopped) return
      source = new EventSource('/api/events')
      for (const type of EVENT_TYPES) {
        source.addEventListener(type, (message) => {
          const event = parseLiveEvent((message as MessageEvent<string>).data)
          if (!event) return
          failures = 0
          deliver(event)
          post({ kind: 'event', event })
        })
      }
      source.onopen = () => status(true)
      source.onerror = () => {
        status(false)
        // A refused or broken stream is closed for good: open a new one after a while.
        if (source?.readyState === EventSource.CLOSED) {
          source = null
          const wait = RETRY_MS[Math.min(failures, RETRY_MS.length - 1)] ?? 30_000
          failures++
          retry = window.setTimeout(open, wait)
        }
      }
    }

    const lead = () => {
      leading.current = true
      open()
    }

    const reportFocus = () => {
      const focused = document.visibilityState === 'visible' && document.hasFocus()
      if (focused) focusedTabs.current.add(tab)
      else focusedTabs.current.delete(tab)
      post({ kind: 'focus', tab, focused })
    }

    if (channel) {
      channel.onmessage = ({ data }: MessageEvent<Message>) => {
        if (data.kind === 'event') deliver(data.event)
        else if (data.kind === 'status') setConnected(data.connected)
        else if (data.kind === 'focus') {
          if (data.focused) focusedTabs.current.add(data.tab)
          else focusedTabs.current.delete(data.tab)
        } else if (data.kind === 'hello') {
          // A tab opened: the stream holder tells it the latest state, and every tab its focus.
          if (leading.current) {
            for (const event of latest.current.values()) post({ kind: 'event', event })
            post({ kind: 'status', connected: source?.readyState === EventSource.OPEN })
          }
          reportFocus()
        }
      }
    }

    if (channel && typeof navigator !== 'undefined' && navigator.locks) {
      void navigator.locks
        .request(LOCK, () => {
          if (stopped) return
          lead()
          // Held until this tab goes away; the next tab in line then takes the stream.
          return new Promise<void>((resolve) => {
            releaseLock = resolve
          })
        })
        .catch(() => {})
      post({ kind: 'hello' })
    } else {
      // No locks (an insecure origin) or no channel: every tab has its own stream.
      lead()
    }

    reportFocus()
    window.addEventListener('focus', reportFocus)
    window.addEventListener('blur', reportFocus)
    document.addEventListener('visibilitychange', reportFocus)
    const leave = () => post({ kind: 'focus', tab, focused: false })
    window.addEventListener('pagehide', leave)

    return () => {
      stopped = true
      leave()
      window.clearTimeout(retry)
      source?.close()
      leading.current = false
      releaseLock()
      window.removeEventListener('focus', reportFocus)
      window.removeEventListener('blur', reportFocus)
      document.removeEventListener('visibilitychange', reportFocus)
      window.removeEventListener('pagehide', leave)
      channel?.close()
      setConnected(false)
    }
  }, [enabled, deliver])

  const subscribe = useCallback(
    <T extends LiveEvent['type']>(type: T, handler: (event: LiveOf<T>) => void) => {
      const generic = handler as Handler
      let set = handlers.current.get(type)
      if (!set) {
        set = new Set()
        handlers.current.set(type, set)
      }
      set.add(generic)
      const last = latest.current.get(type)
      if (last) generic(last)
      return () => {
        set.delete(generic)
      }
    },
    [],
  )

  const value = useMemo<LiveValue>(
    () => ({
      connected,
      subscribe,
      isLeader: () => leading.current,
      anyTabFocused: () => focusedTabs.current.size > 0,
    }),
    [connected, subscribe],
  )
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>
}
