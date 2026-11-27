// The live feed (GET /api/events): what every Agent is doing and what is open in Attention,
// pushed by the daemon when it changes. One tab per browser holds the stream (a Web Lock picks
// it) and passes each event to the others over a BroadcastChannel, so many open tabs still use
// one connection. Where the browser has no Web Locks (an http:// address other than this
// computer), each tab holds a stream only while it is visible, so hidden tabs cannot use up the
// browser's few connections to the server. While no stream is up (`connected` false) readers ask
// on their own, as before.

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
import { apiFetch } from './api'

const CHANNEL = 'bazilion-live'
const LOCK = 'bazilion-live'
const EVENT_TYPES: readonly LiveEvent['type'][] = ['activity', 'attention', 'workspace']
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
    // An Agent's `screen` or `theme` happens once: a reader that comes later must not replay it.
    if (event.type !== 'workspace') latest.current.set(event.type, event)
    for (const handler of handlers.current.get(event.type) ?? []) {
      // One reader's failure must not keep the event from the others.
      try {
        handler(event)
      } catch (error) {
        console.warn('live feed reader failed:', error)
      }
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    let stopped = false
    let source: EventSource | null = null
    let retry: number | undefined
    let failures = 0
    const tab = Math.random().toString(36).slice(2)
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL)
    // Shared: one tab holds the stream for all. Otherwise each tab has its own and keeps its
    // events and its status to itself.
    const shared = Boolean(channel && typeof navigator !== 'undefined' && navigator.locks)
    const post = (message: Message) => channel?.postMessage(message)
    const share = (message: Message) => {
      if (shared) post(message)
    }
    let releaseLock: () => void = () => {}

    let wasDown = false
    const status = (value: boolean) => {
      setConnected(value)
      share({ kind: 'status', connected: value })
      // Back after the stream was down, as after a restart for an upgrade: one request says
      // which build answers now (lib/build.ts).
      if (value && wasDown) void apiFetch('/api/activity').catch(() => {})
      wasDown = !value
    }

    const open = () => {
      if (stopped || (!shared && document.visibilityState === 'hidden')) return
      source = new EventSource('/api/events')
      for (const type of EVENT_TYPES) {
        source.addEventListener(type, (message) => {
          const event = parseLiveEvent((message as MessageEvent<string>).data)
          if (!event) return
          failures = 0
          deliver(event)
          share({ kind: 'event', event })
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
        if (data.kind === 'event') {
          if (shared) deliver(data.event)
        } else if (data.kind === 'status') {
          if (shared) setConnected(data.connected)
        } else if (data.kind === 'focus') {
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

    const close = () => {
      window.clearTimeout(retry)
      source?.close()
      source = null
      setConnected(false)
    }
    // Without a shared stream, a hidden tab lets go of its own.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') close()
      else if (!source) open()
    }

    if (shared) {
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
      // No locks (an http:// address other than this computer): every visible tab has its own.
      leading.current = true
      if (document.visibilityState !== 'hidden') open()
      document.addEventListener('visibilitychange', onVisibility)
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
      document.removeEventListener('visibilitychange', onVisibility)
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
