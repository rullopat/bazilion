// How much is open in Attention, and how much of it waits on the operator, for the top bar's
// count and the tab title. One poll serves both; it pauses while the tab is hidden and runs again
// as soon as it shows, so a question asked meanwhile is counted when the operator looks.

import type { AttentionSummary } from '@bazilion/api-types'
import { useRouterState } from '@tanstack/react-router'
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
import { api } from './api'

const POLL_MS = 5_000

export interface AttentionCount {
  /** Every open item: decisions, errors and warnings. */
  open: number
  /** Open items that wait on the operator: questions, commands to approve, other decisions. */
  waiting: number
  /** Of those, the Agents' questions and commands to approve. */
  agentWaits: number
  /** Ask again now, after something here changed what is open. */
  refresh: () => void
}

const AttentionCountContext = createContext<AttentionCount>({
  open: 0,
  waiting: 0,
  agentWaits: 0,
  refresh: () => {},
})

export function useAttentionCount(): AttentionCount {
  return useContext(AttentionCountContext)
}

type Counts = Omit<AttentionCount, 'refresh'>

/** The counts from a summary: what the badge shows and what the title shows. */
export function attentionCounts(summary: AttentionSummary): Counts {
  return {
    open: summary.openTotal,
    waiting: summary.bySeverity.action_required,
    agentWaits: (summary.byKind.agent_question ?? 0) + (summary.byKind.command_approval ?? 0),
  }
}

export function AttentionCountProvider({
  enabled,
  children,
}: {
  /** Off where nobody is signed in or Setup is not done (login, first run). */
  enabled: boolean
  children: ReactNode
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const [counts, setCounts] = useState<Counts>({ open: 0, waiting: 0, agentWaits: 0 })
  const controller = useRef<AbortController | null>(null)

  const load = useCallback(() => {
    if (document.visibilityState === 'hidden') return
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    api<AttentionSummary>('/api/attention/summary', { signal: current.signal })
      .then((summary) => setCounts(attentionCounts(summary)))
      .catch(() => {
        // The count keeps its last value; the Attention page shows the error.
      })
  }, [])

  // Every page change asks at once; the interval keeps it current in between.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger, not an input.
  useEffect(() => {
    if (!enabled) return
    load()
    const timer = setInterval(load, POLL_MS)
    const onShow = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onShow)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onShow)
      controller.current?.abort()
    }
  }, [enabled, load, pathname])

  const value = useMemo(() => ({ ...counts, refresh: load }), [counts, load])
  return <AttentionCountContext.Provider value={value}>{children}</AttentionCountContext.Provider>
}
