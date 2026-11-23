// A Team's day at a glance, on its page: what its Agents handed to each other, delivered, worked
// on and wait on you for since this morning, newest first, each a link to where it happened. When
// a lead delegates, the work spreads over several conversations; this is where it comes together.

import type { TeamDayEvent, TeamDayKind, TeamDayResponse } from '@bazilion/api-types'
import { Link } from '@tanstack/react-router'
import {
  ArrowRightLeft,
  CornerDownLeft,
  FileText,
  type LucideIcon,
  MessageSquare,
  MessageSquareWarning,
  ShieldAlert,
} from 'lucide-react'
import { useState } from 'react'
import { shortTime, useActivity } from '../../lib/activity'
import { api } from '../../lib/api'
import { useHydrated, useResource } from '../../lib/use-resource'

const SHOWN = 12

const KIND: Record<TeamDayKind, { icon: LucideIcon; verb: string; tone: string }> = {
  handoff: { icon: ArrowRightLeft, verb: 'handed off to', tone: 'text-sapphire' },
  reply: { icon: CornerDownLeft, verb: 'replied to', tone: 'text-sapphire' },
  file: { icon: FileText, verb: 'delivered', tone: 'text-success' },
  worked: { icon: MessageSquare, verb: 'worked in', tone: 'text-mocha' },
  question: { icon: MessageSquareWarning, verb: 'asks you', tone: 'text-warning' },
  approval: { icon: ShieldAlert, verb: 'waits for your approval', tone: 'text-warning' },
}

/** Where an event happened: the conversation, the file, or the Agent it went to. */
function placeOf(teamId: string, event: TeamDayEvent): Record<string, string> {
  if (event.kind === 'file' && event.resultId) {
    return { team: teamId, view: 'files', result: event.resultId }
  }
  if (event.kind === 'handoff' && event.otherAgentId) return { agent: event.otherAgentId }
  return {
    agent: event.agentId,
    ...(event.kind === 'worked' && event.conversationId
      ? { conversation: event.conversationId }
      : {}),
  }
}

export function TeamToday({ teamId }: { teamId: string }) {
  const { turnsEnded } = useActivity()
  const hydrated = useHydrated()
  const [all, setAll] = useState(false)
  const day = useResource(
    (signal) => {
      const since = new Date()
      since.setHours(0, 0, 0, 0)
      return api<TeamDayResponse>(
        `/api/teams/${encodeURIComponent(teamId)}/today?since=${since.getTime()}`,
        { signal },
      )
    },
    [teamId],
    { refreshOn: turnsEnded },
  )
  const events = day.data?.events ?? []
  if (!hydrated || day.error || events.length === 0) {
    return (
      <p className="m-0 text-sm text-muted-foreground">
        {day.error ?? (day.data ? 'Nothing yet today.' : 'Loading…')}
      </p>
    )
  }
  const shown = all ? events : events.slice(0, SHOWN)
  return (
    <div>
      <ol className="m-0 list-none divide-y divide-border rounded-2xl border border-border bg-card p-0">
        {shown.map((event) => {
          const kind = KIND[event.kind]
          const Icon = kind.icon
          return (
            <li
              key={`${event.kind}:${event.at}:${event.agentId}:${event.resultId ?? event.conversationId ?? event.text}`}
            >
              <Link
                to="/"
                search={placeOf(teamId, event)}
                className="flex min-w-0 items-start gap-2.5 px-3 py-2 text-foreground no-underline hover:bg-accent/30"
              >
                <Icon className={`mt-0.5 size-4 shrink-0 ${kind.tone}`} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">
                    <strong className="font-semibold">{event.agentName}</strong> {kind.verb}
                    {event.otherAgentName && (
                      <>
                        {' '}
                        <strong className="font-semibold">{event.otherAgentName}</strong>
                      </>
                    )}
                  </span>
                  <span className="block truncate text-xs text-mocha">{event.text}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {shortTime(event.at)}
                </span>
              </Link>
            </li>
          )
        })}
      </ol>
      {(events.length > SHOWN || day.data?.truncated) && !all && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="unstyled mt-2 text-sm font-semibold text-sapphire hover:text-sapphire-deep"
        >
          Show all {events.length}
          {day.data?.truncated ? '+' : ''}
        </button>
      )}
    </div>
  )
}
