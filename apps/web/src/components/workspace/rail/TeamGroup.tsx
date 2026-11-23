// One Team in the rail: a fold with its name, what its Agents are doing and a way into the Team,
// then a row per Agent.

import type { Agent, Team } from '@bazilion/api-types'
import { Link } from '@tanstack/react-router'
import { ChevronRight, PanelRight } from 'lucide-react'
import { teamSummary, type useActivity } from '../../../lib/activity'
import type { useWorkspace } from '../context'
import { AgentRow } from './AgentRow'

export function TeamGroup({
  team,
  members,
  current,
  isOpen,
  onOpenChange,
  openAgentId,
  selectedId,
  activity,
  panel,
  onRename,
  onArchive,
}: {
  team: Team
  members: Agent[]
  /** The Team in view. */
  current: boolean
  isOpen: boolean
  /** The user opened or closed the fold. */
  onOpenChange: (open: boolean) => void
  /** The open Agent when it belongs to this Team: opening the Team keeps it open. */
  openAgentId: string | null
  selectedId: string | null
  activity: ReturnType<typeof useActivity>
  panel: ReturnType<typeof useWorkspace>['search']['panel']
  onRename: (agent: Agent) => void
  onArchive: (agent: Agent) => void
}) {
  const summary = teamSummary(members.map((agent) => activity.stateOf(agent.id)))
  return (
    <details
      open={isOpen}
      onToggle={(event) => {
        const next = event.currentTarget.open
        if (next === isOpen) return
        onOpenChange(next)
      }}
      className="group/details mb-1 last:mb-0"
    >
      <summary
        className={`flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg py-1 pl-2 pr-1 text-sm transition-colors hover:bg-accent/60 [&::-webkit-details-marker]:hidden ${
          current ? 'bg-muted text-foreground' : 'text-mocha'
        }`}
      >
        <ChevronRight
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/details:rotate-90"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate font-semibold">{team.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{summary || members.length}</span>
        <Link
          to="/"
          search={{
            ...(openAgentId !== null ? { agent: openAgentId } : {}),
            team: team.id,
            panel: 'team',
          }}
          aria-label={`Open ${team.name}: members, USER.md, memory`}
          title="Open the Team"
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-card hover:text-primary"
        >
          <PanelRight className="size-3.5" aria-hidden="true" />
        </Link>
      </summary>
      {members.length === 0 ? (
        <div className="py-2 pl-7 pr-2 text-xs text-muted-foreground">No agents in this team</div>
      ) : (
        <div className="space-y-0.5 py-1 pl-1.5">
          {members.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              selected={agent.id === selectedId}
              state={activity.stateOf(agent.id)}
              lastActivityAt={activity.byAgent.get(agent.id)?.lastActivityAt ?? null}
              panel={panel}
              onRename={() => onRename(agent)}
              onArchive={() => onArchive(agent)}
            />
          ))}
        </div>
      )}
    </details>
  )
}
