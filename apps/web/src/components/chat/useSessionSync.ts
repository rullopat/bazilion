// Keeps one Agent's chat level with the daemon: the saved history, the conversation file's head
// and the follow-up queue, read again when the live feed (or, without it, a poll) says something
// moved elsewhere.

import type {
  AgentActivity,
  ProviderMessage,
  SessionHeadResponse,
  SessionMessagesResponse,
  UserQueueListResponse,
} from '@bazilion/api-types'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { useLive } from '../../lib/live'
import {
  activityReaction,
  EMPTY_HEAD,
  headMoved,
  isQueueWorking,
  openFollowUps,
} from './session-sync'
import type { Draft } from './useChatSession'

const SESSION_POLL_MS = 10_000
const QUEUE_POLL_MS = 5_000

export function useSessionSync({
  agentId,
  base,
  initialSessionHead,
  onConversation,
  streamingRef,
  pushNote,
  onHistory,
}: {
  agentId: string
  /** The Agent's API path. */
  base: string
  /** The SSR head of the conversation file; the stale poll compares against it. */
  initialSessionHead?: SessionHeadResponse
  /** The conversation on screen changed: the first turn made one, or another was loaded. */
  onConversation?: (conversationId: string | null) => void
  /** This tab streams a turn: the history is not reloaded under it. */
  streamingRef: RefObject<boolean>
  pushNote: (content: string) => void
  /** The saved history was loaded again. */
  onHistory: (messages: ProviderMessage[]) => void
}) {
  const [stale, setStale] = useState(false)
  const [historyUnavailable, setHistoryUnavailable] = useState(
    initialSessionHead?.unavailable ?? false,
  )
  const [queue, setQueue] = useState<UserQueueListResponse | null>(null)

  const knownHeadRef = useRef(initialSessionHead ?? EMPTY_HEAD)
  const queueRef = useRef<UserQueueListResponse | null>(null)
  const staleRef = useRef(stale)
  staleRef.current = stale
  const activityRef = useRef<AgentActivity | null>(null)
  const feed = useLive()

  const queueWorking = isQueueWorking(queue)

  function know(head: SessionHeadResponse) {
    if (head.conversationId !== knownHeadRef.current.conversationId) {
      onConversation?.(head.conversationId)
    }
    knownHeadRef.current = head
  }

  async function refreshHistory() {
    if (streamingRef.current) return
    try {
      const body = await api<SessionMessagesResponse>(`${base}/sessions/messages`)
      setHistoryUnavailable(body.head.unavailable ?? false)
      onHistory(body.messages)
      know(body.head)
      setStale(false)
    } catch {
      pushNote('Conversation history is unavailable. Your draft is preserved.')
    }
  }

  async function refreshKnownHead() {
    try {
      const head = await api<SessionHeadResponse>(`${base}/sessions/head`)
      const prior = knownHeadRef.current.conversationId
      if (prior && prior !== head.conversationId) {
        setStale(true)
        return
      }
      setHistoryUnavailable(head.unavailable ?? false)
      know(head)
    } catch {
      // The next poll tries again.
    }
  }

  /** True when a follow-up had finished and the history was loaded again. */
  async function refreshQueue(): Promise<boolean> {
    try {
      const next = await api<UserQueueListResponse>(`${base}/queue`)
      // A follow-up finished: its reply is in the history now.
      const finished =
        openFollowUps(next) < openFollowUps(queueRef.current) && !streamingRef.current
      if (finished) void refreshHistory()
      queueRef.current = next
      setQueue(next)
      return finished
    } catch {
      // The next refresh tries again.
      return false
    }
  }

  /** Activity from another source (Telegram, a schedule, another tab) shows a reload banner. */
  async function checkHead() {
    if (!initialSessionHead || staleRef.current || streamingRef.current) return
    try {
      const head = await api<SessionHeadResponse>(`${base}/sessions/head`)
      if (headMoved(head, knownHeadRef.current)) {
        setStale(true)
        // Another source may be running a turn; the queue reports it, so Stop can show.
        void refreshQueue()
      }
    } catch {
      // Transient: the next change tries again.
    }
  }

  /** Queue a follow-up; returns the draft to give back to the composer when it was not queued. */
  async function enqueue(draft: Draft): Promise<Draft | null> {
    try {
      await api(`${base}/queue`, {
        body: { message: draft.text, attachments: draft.attachments },
      })
      void refreshQueue()
      return null
    } catch (error) {
      pushNote(`The follow-up was not queued: ${errorMessage(error)}. Your draft is kept.`)
      return draft
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once; refreshQueue reads refs.
  useEffect(() => {
    void refreshQueue()
  }, [])

  // The live feed says when this Agent starts or stops working, or its conversation moves on: the
  // queue is read again then, and a conversation that moved without this tab is reported stale.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the handlers read refs.
  useEffect(
    () =>
      feed.subscribe('activity', (event) => {
        const now = event.agents.find((entry) => entry.agentId === agentId) ?? null
        const was = activityRef.current
        activityRef.current = now
        if (!now || streamingRef.current) return
        const reaction = activityReaction(was, now)
        if (reaction === 'head') {
          void checkHead()
        } else if (reaction !== null) {
          void refreshQueue().then((reloaded) => {
            if (reaction === 'queue-then-head' && !reloaded) void checkHead()
          })
        }
      }),
    [feed.subscribe, agentId],
  )

  // Without the live feed: ask about follow-ups while one runs.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshQueue reads refs.
  useEffect(() => {
    if (!queueWorking || feed.connected) return
    const timer = setInterval(() => {
      if (!document.hidden) void refreshQueue()
    }, QUEUE_POLL_MS)
    return () => clearInterval(timer)
  }, [queueWorking, feed.connected])

  // Without the live feed: look for activity from another source every few seconds.
  // biome-ignore lint/correctness/useExhaustiveDependencies: checkHead reads refs.
  useEffect(() => {
    if (!initialSessionHead || stale || feed.connected) return
    const timer = setInterval(() => {
      if (!document.hidden) void checkHead()
    }, SESSION_POLL_MS)
    return () => clearInterval(timer)
  }, [base, initialSessionHead, stale, feed.connected])

  return {
    stale,
    dismissStale: () => setStale(false),
    historyUnavailable,
    queue,
    /** The conversation this tab last knew of; null before the Agent's first turn. */
    knownConversationId: () => knownHeadRef.current.conversationId,
    refreshHistory,
    refreshKnownHead,
    refreshQueue,
    enqueue,
  }
}
