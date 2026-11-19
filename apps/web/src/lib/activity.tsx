// What every Agent is doing, for the rail, the conversation and the panels. One poll of
// /api/activity feeds them all; "new since you last looked" is remembered in this browser.

import type { ActivityResponse, AgentActivity } from '@bazilion/api-types'
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
import { describeStep } from './tool-steps'

const POLL_MS = 3_000
const SEEN_KEY = 'bz_seen'

export type AgentStateKind = 'needs' | 'working' | 'paused' | 'fresh' | 'idle'

export interface AgentState {
  kind: AgentStateKind
  text: string
}

/** What the operator had seen of an Agent when they last had its conversation open. */
export interface Seen {
  at: number
  results: number
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`

/**
 * One line for an Agent. What needs the operator comes first, then work in progress, then what
 * is new since they last looked.
 */
export function agentState(
  activity: AgentActivity | undefined,
  seen: Seen | undefined,
  nameOf: (agentId: string) => string | undefined = () => undefined,
): AgentState {
  if (!activity) return { kind: 'idle', text: 'Idle' }
  if (activity.questions > 0) {
    return { kind: 'needs', text: `Needs you: ${plural(activity.questions, 'question')}` }
  }
  if (activity.approvals > 0) {
    return { kind: 'needs', text: `Needs you: ${plural(activity.approvals, 'command')} to approve` }
  }
  if (activity.working) {
    const step = activity.step
    if (!step) return { kind: 'working', text: 'Working' }
    if (step.tool === 'send_message') {
      const name = step.target ? nameOf(step.target) : undefined
      return { kind: 'working', text: `Working: messaging ${name ?? 'a teammate'}` }
    }
    const target = step.target
    const args = target
      ? { path: target, command: target, url: target, query: target, key: target, file: target }
      : null
    return { kind: 'working', text: `Working: ${describeStep(step.tool, args).doing}` }
  }
  if (activity.queuePaused) return { kind: 'paused', text: 'Follow-ups paused' }
  if (seen) {
    const files = activity.results - seen.results
    if (files > 0) return { kind: 'fresh', text: plural(files, 'new file') }
    if (activity.lastActivityAt !== null && activity.lastActivityAt > seen.at) {
      return { kind: 'fresh', text: 'New activity' }
    }
  }
  return {
    kind: 'idle',
    text: activity.lastActivityAt === null ? 'No conversation yet' : 'Idle',
  }
}

/** "1 waiting · 2 working" for a Team's header; empty when everyone is idle. */
export function teamSummary(states: readonly AgentState[]): string {
  const count = (kind: AgentStateKind) => states.filter((state) => state.kind === kind).length
  return [
    count('needs') ? `${count('needs')} waiting` : null,
    count('working') ? `${count('working')} working` : null,
    count('fresh') ? `${count('fresh')} new` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * Whether a turn ended between two readings of the feed: an Agent stopped working, or an idle
 * Agent's conversation or saved files moved on (a turn shorter than the time between readings).
 */
export function turnEnded(
  before: readonly AgentActivity[],
  after: readonly AgentActivity[],
): boolean {
  const known = new Map(before.map((activity) => [activity.agentId, activity]))
  return after.some((now) => {
    const was = known.get(now.agentId)
    if (!was || now.working) return false
    return was.working || was.lastActivityAt !== now.lastActivityAt || was.results !== now.results
  })
}

interface ActivityValue {
  byAgent: ReadonlyMap<string, AgentActivity>
  stateOf: (agentId: string) => AgentState
  /** Goes up each time any Agent's turn ends: reload what a turn may have changed. */
  turnsEnded: number
  refresh: () => void
}

const ActivityContext = createContext<ActivityValue | null>(null)

function readSeen(): Record<string, Seen> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, Seen>) : {}
  } catch {
    return {}
  }
}

export function ActivityProvider({
  initial,
  openAgentId,
  names,
  children,
}: {
  /** The feed as the page was rendered. */
  initial: AgentActivity[]
  /** The Agent whose conversation is on screen: it counts as seen. */
  openAgentId: string | null
  names: ReadonlyMap<string, string>
  children: ReactNode
}) {
  const [agents, setAgents] = useState(initial)
  const [seen, setSeen] = useState<Record<string, Seen> | null>(null)
  const [turnsEnded, setTurnsEnded] = useState(0)
  const lastRef = useRef(initial)

  const refresh = useCallback(() => {
    api<ActivityResponse>('/api/activity')
      .then((body) => {
        const ended = turnEnded(lastRef.current, body.agents)
        lastRef.current = body.agents
        setAgents(body.agents)
        if (ended) setTurnsEnded((count) => count + 1)
      })
      .catch(() => {
        // The next poll tries again; the rail keeps what it last knew.
      })
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) refresh()
    }, POLL_MS)
    const onVisible = () => {
      if (!document.hidden) refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  // What this browser remembers is read after hydration, so the first paint matches the server.
  useEffect(() => setSeen(readSeen()), [])

  // An Agent met for the first time has nothing new; the open conversation is always seen.
  useEffect(() => {
    if (!seen) return
    let next: Record<string, Seen> | null = null
    for (const activity of agents) {
      const current = seen[activity.agentId]
      const now = { at: activity.lastActivityAt ?? 0, results: activity.results }
      const open = activity.agentId === openAgentId && !document.hidden
      if (!current || (open && (current.at !== now.at || current.results !== now.results))) {
        next = { ...(next ?? seen), [activity.agentId]: now }
      }
    }
    if (!next) return
    setSeen(next)
    try {
      window.localStorage.setItem(SEEN_KEY, JSON.stringify(next))
    } catch {
      // Storage is unavailable: the markers last for this page only.
    }
  }, [agents, seen, openAgentId])

  const value = useMemo<ActivityValue>(() => {
    const byAgent = new Map(agents.map((activity) => [activity.agentId, activity]))
    return {
      byAgent,
      stateOf: (agentId) =>
        agentState(
          byAgent.get(agentId),
          agentId === openAgentId ? undefined : seen?.[agentId],
          (id) => names.get(id),
        ),
      turnsEnded,
      refresh,
    }
  }, [agents, seen, openAgentId, names, turnsEnded, refresh])

  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>
}

export function useActivity(): ActivityValue {
  const value = useContext(ActivityContext)
  if (!value) throw new Error('useActivity needs an ActivityProvider')
  return value
}

/** The feed when there is one: a conversation can also render on its own. */
export function useActivityOptional(): ActivityValue | null {
  return useContext(ActivityContext)
}

/** A short clock or date for "last active": 12:04 today, Tue this week, 12 Nov otherwise. */
export function shortTime(at: number, now = Date.now()): string {
  const date = new Date(at)
  const today = new Date(now)
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  if (now - at < 6 * 24 * 3_600_000) return date.toLocaleDateString([], { weekday: 'short' })
  return date.toLocaleDateString([], { day: 'numeric', month: 'short' })
}
