// Keeps one Agent's chat level with the daemon: the saved history, the conversation file's head
// and the follow-up queue, read again when the live feed (or, without it, a poll) says something
// moved elsewhere. What another source added (a teammate's message, Telegram, a schedule, a
// follow-up, the terminal, another tab) is loaded at once, except under an open edit: it waits
// for the edit to end.

import type {
  AgentActivity,
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
  hold,
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
  /** An edit is open: what arrives meanwhile is loaded when it ends. */
  hold: boolean
  pushNote: (content: string) => void
  /**
   * The conversation as the daemon has it now: messages, compactions, how full the window is.
   * `arrived` when it is the same conversation with what another source added since.
   */
  onHistory: (history: SessionMessagesResponse, arrived: boolean) => void
}) {
  /** Another source moved the conversation while an edit was open. */
  const [behind, setBehind] = useState(false)
  const [historyUnavailable, setHistoryUnavailable] = useState(
    initialSessionHead?.unavailable ?? false,
  )
  const [queue, setQueue] = useState<UserQueueListResponse | null>(null)

  const knownHeadRef = useRef(initialSessionHead ?? EMPTY_HEAD)
  const queueRef = useRef<UserQueueListResponse | null>(null)
  const holdRef = useRef(hold)
  holdRef.current = hold
  const activityRef = useRef<AgentActivity | null>(null)
  // One look at the head at a time; a change that comes in meanwhile has it look once more.
  const catchingUp = useRef(false)
  const lookAgain = useRef(false)
  const feed = useLive()

  const queueWorking = isQueueWorking(queue)

  function know(head: SessionHeadResponse) {
    if (head.conversationId !== knownHeadRef.current.conversationId) {
      onConversation?.(head.conversationId)
    }
    knownHeadRef.current = head
  }

  /** Load the conversation again; `arrived` when another source added to the one on screen. */
  async function refreshHistory(arrived = false) {
    if (streamingRef.current) return
    try {
      const body = await api<SessionMessagesResponse>(`${base}/sessions/messages`)
      if (streamingRef.current) return
      setHistoryUnavailable(body.head.unavailable ?? false)
      const same = body.head.conversationId === knownHeadRef.current.conversationId
      onHistory(body, arrived && same)
      know(body.head)
      setBehind(false)
    } catch {
      pushNote('Conversation history is unavailable. Your draft is preserved.')
    }
  }

  async function refreshKnownHead() {
    try {
      const head = await api<SessionHeadResponse>(`${base}/sessions/head`)
      const prior = knownHeadRef.current.conversationId
      if (prior && prior !== head.conversationId) {
        // Another conversation was selected elsewhere while this tab's turn ran: show that one.
        void refreshHistory()
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
      if (finished) void refreshHistory(true)
      queueRef.current = next
      setQueue(next)
      return finished
    } catch {
      // The next refresh tries again.
      return false
    }
  }

  /** Activity from another source (Telegram, a schedule, another tab) is loaded at once. */
  async function lookAtHead() {
    if (!initialSessionHead || streamingRef.current) return
    try {
      const head = await api<SessionHeadResponse>(`${base}/sessions/head`)
      if (!headMoved(head, knownHeadRef.current)) return
      // Another source may be running a turn; the queue reports it, so Stop can show.
      void refreshQueue()
      if (holdRef.current) setBehind(true)
      else await refreshHistory(true)
    } catch {
      // Transient: the next change tries again.
    }
  }

  function checkHead() {
    if (catchingUp.current) {
      lookAgain.current = true
      return
    }
    catchingUp.current = true
    void (async () => {
      try {
        do {
          lookAgain.current = false
          await lookAtHead()
        } while (lookAgain.current)
      } finally {
        catchingUp.current = false
      }
    })()
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
  // queue is read again then, and what another source added to the conversation is loaded.
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
          checkHead()
        } else if (reaction !== null) {
          void refreshQueue().then((reloaded) => {
            if (reaction === 'queue-then-head' && !reloaded) checkHead()
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
    if (!initialSessionHead || feed.connected) return
    const timer = setInterval(() => {
      if (!document.hidden) checkHead()
    }, SESSION_POLL_MS)
    return () => clearInterval(timer)
  }, [base, initialSessionHead, feed.connected])

  // The edit ended (sent or cancelled): what arrived meanwhile shows now. A sent edit streams its
  // own turn, which loads the conversation when it ends.
  // biome-ignore lint/correctness/useExhaustiveDependencies: checkHead reads refs.
  useEffect(() => {
    if (!hold && behind) {
      setBehind(false)
      checkHead()
    }
  }, [hold, behind])

  return {
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
