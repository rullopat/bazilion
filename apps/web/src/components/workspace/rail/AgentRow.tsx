// One Agent in the rail: its avatar, name and what it is doing, with a menu for its settings,
// renaming and archiving.

import { type Agent, chosenName } from '@bazilion/api-types'
import { Link } from '@tanstack/react-router'
import { Archive, ArrowDown, ArrowUp, Ellipsis, Pencil, Send, Settings2 } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { type AgentState, shortTime } from '../../../lib/activity'
import { useHydrated } from '../../../lib/use-resource'
import { AgentAvatar } from '../../AgentAvatar'
import type { useWorkspace } from '../context'
import { STATE_DOT, STATE_TEXT } from '../state-style'
import { MENU_ITEM } from './menu'
import { DROP_MARK_CLASS, type useRailOrder } from './use-rail-order'

export function AgentRow({
  agent,
  selected,
  state,
  lastActivityAt,
  panel,
  onRename,
  onArchive,
  order,
  onMoveUp,
  onMoveDown,
}: {
  agent: Agent
  selected: boolean
  state: AgentState
  lastActivityAt: number | null
  panel: ReturnType<typeof useWorkspace>['search']['panel']
  onRename: () => void
  onArchive: () => void
  /** Dragging rows within the Team (BAZ-098). */
  order: ReturnType<typeof useRailOrder>
  /** Move the Agent one place up or down in its Team; absent at that end. */
  onMoveUp?: () => void
  onMoveDown?: () => void
}) {
  const hydrated = useHydrated()
  const mark = order.dropMark(agent.id)
  return (
    <div
      className={`group/row relative rounded-2xl ${mark ? DROP_MARK_CLASS[mark] : ''}`}
      {...order.dropTarget(agent.id, agent.teamId)}
    >
      <Link
        {...order.dragSource({ kind: 'agent', id: agent.id, teamId: agent.teamId })}
        to="/"
        search={{ agent: agent.id, ...(panel ? { panel } : {}) }}
        aria-current={selected ? 'page' : undefined}
        className={`flex min-h-[3.1rem] items-center gap-2.5 rounded-2xl border py-1.5 pl-2 pr-9 transition-colors hover:bg-accent/60 ${
          selected ? 'border-primary/20 bg-accent shadow-baziu-sm' : 'border-transparent'
        }`}
      >
        <AgentAvatar identity={agent.identity} size={30} />
        <span className="block min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span
              className={`min-w-0 truncate text-sm font-semibold leading-tight ${
                selected ? 'text-accent-foreground' : 'text-foreground'
              }`}
            >
              {agent.name}
              {chosenName(agent) && (
                <span className="font-normal text-muted-foreground"> · {chosenName(agent)}</span>
              )}
            </span>
            {agent.telegramTopicId !== null && (
              <span
                className="shrink-0 text-primary"
                title={`Telegram topic #${agent.telegramTopicId}`}
                role="img"
                aria-label={`Bound to Telegram topic ${agent.telegramTopicId}`}
              >
                <Send className="size-3" aria-hidden="true" />
              </span>
            )}
            {hydrated && lastActivityAt !== null && (
              <time
                dateTime={new Date(lastActivityAt).toISOString()}
                className="ml-auto shrink-0 text-xs font-normal text-muted-foreground"
              >
                {shortTime(lastActivityAt)}
              </time>
            )}
          </span>
          <span
            className={`mt-0.5 flex items-center gap-1.5 text-xs leading-snug ${STATE_TEXT[state.kind]}`}
          >
            <span
              className={`size-[7px] shrink-0 rounded-full ${STATE_DOT[state.kind]}`}
              aria-hidden="true"
            />
            <span className="min-w-0 truncate">{state.text}</span>
          </span>
        </span>
      </Link>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label={`More for ${agent.name}`}
            className="unstyled absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-card hover:text-primary focus-visible:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
          >
            <Ellipsis className="size-4" aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={4}
            className="z-50 w-48 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-baziu-lg outline-none"
          >
            <DropdownMenu.Item asChild className={MENU_ITEM}>
              <Link to="/" search={{ agent: agent.id, panel: 'agent' }}>
                <Settings2 className="size-3.5" aria-hidden="true" />
                Agent settings
              </Link>
            </DropdownMenu.Item>
            <DropdownMenu.Item className={MENU_ITEM} onSelect={onRename}>
              <Pencil className="size-3.5" aria-hidden="true" />
              Rename
            </DropdownMenu.Item>
            <DropdownMenu.Item className={MENU_ITEM} disabled={!onMoveUp} onSelect={onMoveUp}>
              <ArrowUp className="size-3.5" aria-hidden="true" />
              Move up
            </DropdownMenu.Item>
            <DropdownMenu.Item className={MENU_ITEM} disabled={!onMoveDown} onSelect={onMoveDown}>
              <ArrowDown className="size-3.5" aria-hidden="true" />
              Move down
            </DropdownMenu.Item>
            <DropdownMenu.Item className={MENU_ITEM} onSelect={onArchive}>
              <Archive className="size-3.5" aria-hidden="true" />
              Archive
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}
