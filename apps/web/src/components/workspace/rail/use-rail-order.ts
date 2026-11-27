// The owner's order of the rail (BAZ-098): Teams, and each Team's Agents, moved by a drag or by
// Move up / Move down. The new order shows at once and is saved in Bazilion, so every browser,
// Manage and the CLI list the same; a refusal puts the order back and says why.

import type { Agent, SetOrderRequest, Team } from '@bazilion/api-types'
import { useRouter } from '@tanstack/react-router'
import { type DragEvent, useRef, useState } from 'react'
import { api, errorMessage } from '../../../lib/api'
import { inOrder, moveBy, moveNextTo } from './order'

/** What is being dragged: a Team, or an Agent within its Team. */
type Dragged = { kind: 'team'; id: string } | { kind: 'agent'; id: string; teamId: string }

/** Where a drop would put the dragged row: before or after this one. */
export type DropMark = 'before' | 'after' | null

// A type of our own, so that a row dropped on a text field types nothing into it.
const DRAG_TYPE = 'application/x-bazilion-rail'

export function useRailOrder(teams: Team[], agents: Agent[]) {
  const router = useRouter()
  // Orders shown before the daemon has them; dropped once it lists them (or refuses).
  const [teamIds, setTeamIds] = useState<string[] | undefined>()
  const [agentIds, setAgentIds] = useState<Record<string, string[]>>({})
  const [error, setError] = useState<string | null>(null)
  // The latest save of each order (the Teams', each Team's Agents'), so that a refusal puts back
  // its own order even while another order is being saved.
  const saving = useRef(new Map<string, number>())
  const dragged = useRef<Dragged | null>(null)
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null)

  const sortedTeams = inOrder(teams, teamIds)
  const membersOf = (teamId: string) =>
    inOrder(
      agents.filter((agent) => agent.teamId === teamId),
      agentIds[teamId],
    )

  async function save(path: string, ids: string[], show: (ids: string[] | undefined) => void) {
    const mine = (saving.current.get(path) ?? 0) + 1
    saving.current.set(path, mine)
    show(ids)
    setError(null)
    try {
      await api(path, { method: 'PUT', body: { ids } satisfies SetOrderRequest })
      await router.invalidate()
    } catch (failure) {
      setError(`The new order was not saved: ${errorMessage(failure)}`)
    } finally {
      // A later move of the same order keeps showing until it is saved too.
      if (mine === saving.current.get(path)) show(undefined)
    }
  }

  const saveTeams = (ids: string[]) => save('/api/teams/order', ids, setTeamIds)
  const saveAgents = (teamId: string, ids: string[]) =>
    save(`/api/teams/${encodeURIComponent(teamId)}/agents/order`, ids, (next) =>
      setAgentIds(({ [teamId]: _left, ...rest }) => (next ? { ...rest, [teamId]: next } : rest)),
    )

  const teamOrder = () => sortedTeams.map((team) => team.id)
  const agentOrder = (teamId: string) => membersOf(teamId).map((agent) => agent.id)

  function moveTeam(id: string, by: -1 | 1) {
    void saveTeams(moveBy(teamOrder(), id, by))
  }
  function moveAgent(teamId: string, id: string, by: -1 | 1) {
    void saveAgents(teamId, moveBy(agentOrder(teamId), id, by))
  }

  /** Props for a row that can be picked up. */
  function dragSource(item: Dragged) {
    return {
      draggable: true,
      onDragStart: (event: DragEvent) => {
        event.stopPropagation()
        dragged.current = item
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData(DRAG_TYPE, item.id)
      },
      onDragEnd: () => {
        dragged.current = null
        setDrop(null)
      },
    }
  }

  /** The drag over `id` is one this row takes: a Team over a Team, an Agent over its teammate. */
  function accepts(id: string, teamId?: string): Dragged | null {
    const item = dragged.current
    if (!item || item.id === id) return null
    if (teamId === undefined) return item.kind === 'team' ? item : null
    return item.kind === 'agent' && item.teamId === teamId ? item : null
  }

  const below = (event: DragEvent) => {
    const box = event.currentTarget.getBoundingClientRect()
    return event.clientY > box.top + box.height / 2
  }

  /** Props for a row a dragged one can be dropped next to (`teamId` for an Agent's row). */
  function dropTarget(id: string, teamId?: string) {
    return {
      onDragOver: (event: DragEvent) => {
        if (!accepts(id, teamId)) return
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = 'move'
        const after = below(event)
        setDrop((current) =>
          current?.id === id && current.after === after ? current : { id, after },
        )
      },
      onDragLeave: (event: DragEvent) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setDrop((current) => (current?.id === id ? null : current))
      },
      onDrop: (event: DragEvent) => {
        const item = accepts(id, teamId)
        if (!item) return
        event.preventDefault()
        event.stopPropagation()
        const after = below(event)
        dragged.current = null
        setDrop(null)
        if (item.kind === 'team') void saveTeams(moveNextTo(teamOrder(), item.id, id, after))
        else void saveAgents(item.teamId, moveNextTo(agentOrder(item.teamId), item.id, id, after))
      },
    }
  }

  const dropMark = (id: string): DropMark =>
    drop?.id === id ? (drop.after ? 'after' : 'before') : null

  return {
    teams: sortedTeams,
    membersOf,
    moveTeam,
    moveAgent,
    dragSource,
    dropTarget,
    dropMark,
    error,
    clearError: () => setError(null),
  }
}

/** The line that shows where a dragged row would land. */
export const DROP_MARK_CLASS: Record<Exclude<DropMark, null>, string> = {
  before: 'shadow-[inset_0_2px_0_0_var(--ring)]',
  after: 'shadow-[inset_0_-2px_0_0_var(--ring)]',
}
