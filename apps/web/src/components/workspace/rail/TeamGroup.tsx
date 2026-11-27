// One Team in the rail: a fold with its name, what its Agents are doing and a way into the Team,
// then a row per Agent.

import type { Agent, Team } from '@bazilion/api-types'
import { Link } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, ChevronRight, Ellipsis, GripVertical, PanelRight } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { teamSummary, type useActivity } from '../../../lib/activity'
import type { useWorkspace } from '../context'
import { AgentRow } from './AgentRow'
import { MENU_ITEM } from './menu'
import { DROP_MARK_CLASS, type useRailOrder } from './use-rail-order'

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
  order,
  onMoveUp,
  onMoveDown,
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
  /** Dragging and moving rows (BAZ-098). */
  order: ReturnType<typeof useRailOrder>
  /** Move the Team one place up or down; absent at that end of the list. */
  onMoveUp?: () => void
  onMoveDown?: () => void
}) {
  const summary = teamSummary(members.map((agent) => activity.stateOf(agent.id)))
  const mark = order.dropMark(team.id)
  return (
    // The way into the Team sits over the fold's line, not inside it: a control inside a
    // <summary> is a control inside a control.
    <div
      className={`group/team relative mb-1 rounded-lg last:mb-0 ${mark ? DROP_MARK_CLASS[mark] : ''}`}
      {...order.dropTarget(team.id)}
    >
      {/* Dragging the header moves the Team; the grip says so when pointed at. */}
      <GripVertical
        aria-hidden="true"
        className="pointer-events-none absolute -left-1.5 top-2.5 size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover/team:opacity-100"
      />
      <details
        open={isOpen}
        onToggle={(event) => {
          const next = event.currentTarget.open
          if (next === isOpen) return
          onOpenChange(next)
        }}
        className="group/details"
      >
        <summary
          {...order.dragSource({ kind: 'team', id: team.id })}
          title="Drag to move the Team"
          className={`flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg py-1 pl-2 pr-16 text-sm transition-colors hover:bg-accent/60 [&::-webkit-details-marker]:hidden ${
            current ? 'bg-muted text-foreground' : 'text-mocha'
          }`}
        >
          <ChevronRight
            className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/details:rotate-90"
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate font-semibold">{team.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {summary || members.length}
          </span>
        </summary>
        {members.length === 0 ? (
          <div className="py-2 pl-7 pr-2 text-xs text-muted-foreground">No agents in this team</div>
        ) : (
          <div className="space-y-0.5 py-1 pl-1.5">
            {members.map((agent, index) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                order={order}
                onMoveUp={index > 0 ? () => order.moveAgent(team.id, agent.id, -1) : undefined}
                onMoveDown={
                  index < members.length - 1
                    ? () => order.moveAgent(team.id, agent.id, 1)
                    : undefined
                }
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
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label={`More for ${team.name}`}
            className="unstyled absolute right-8 top-1 flex size-7 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-card hover:text-primary focus-visible:opacity-100 group-hover/team:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
          >
            <Ellipsis className="size-4" aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={4}
            className="z-50 w-44 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-baziu-lg outline-none"
          >
            <DropdownMenu.Item className={MENU_ITEM} disabled={!onMoveUp} onSelect={onMoveUp}>
              <ArrowUp className="size-3.5" aria-hidden="true" />
              Move up
            </DropdownMenu.Item>
            <DropdownMenu.Item className={MENU_ITEM} disabled={!onMoveDown} onSelect={onMoveDown}>
              <ArrowDown className="size-3.5" aria-hidden="true" />
              Move down
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <Link
        to="/"
        search={{
          ...(openAgentId !== null ? { agent: openAgentId } : {}),
          team: team.id,
          panel: 'team',
        }}
        aria-label={`Open ${team.name}: members, USER.md, memory`}
        title="Open the Team"
        className="absolute right-1 top-1 flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-card hover:text-primary"
      >
        <PanelRight className="size-3.5" aria-hidden="true" />
      </Link>
    </div>
  )
}
