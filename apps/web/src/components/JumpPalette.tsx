// "Jump to": one box that opens any Agent, Team, view or page. Opened from the top bar or with
// ⌘K / Ctrl+K; it loads the lists when it opens, so it works on every page.

import type { ActivityResponse, Agent, Team } from '@bazilion/api-types'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useEffect, useMemo, useState } from 'react'
import { agentState } from '../lib/activity'
import { api } from '../lib/api'
import { parseWorkspaceSearch, type WorkspaceSearch } from '../lib/workspace'
import { AgentAvatar } from './AgentAvatar'

interface Destination {
  key: string
  group: 'Agents' | 'Teams' | 'Go to' | 'Manage'
  label: string
  hint: string
  agent?: Agent
  /** A workspace address, or a page path. */
  search?: WorkspaceSearch
  path?: string
}

const PAGES: Array<[label: string, hint: string, path: string]> = [
  ['Attention', 'Decisions and failures waiting for you', '/attention'],
  ['Agents', 'Every Agent, archived ones too', '/agents'],
  ['Teams', 'Register and remove Teams', '/teams'],
  ['Templates', 'Agent and Team templates', '/templates'],
  ['Skills', 'Prompt skills', '/skills'],
  ['Setup', 'Models, tools, Telegram, access', '/config'],
]

/** Destinations whose label or hint holds every word of the query. */
export function filterDestinations<T extends { label: string; hint: string }>(
  all: readonly T[],
  query: string,
): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...all]
  return all.filter((item) => {
    const text = `${item.label} ${item.hint}`.toLowerCase()
    return words.every((word) => text.includes(word))
  })
}

export function JumpPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const location = useRouterState({ select: (state) => state.location })
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [agents, setAgents] = useState<Agent[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [activity, setActivity] = useState<ActivityResponse['agents']>([])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    const controller = new AbortController()
    const signal = controller.signal
    Promise.all([
      api<Agent[]>('/api/agents', { signal }),
      api<Team[]>('/api/teams', { signal }),
      api<ActivityResponse>('/api/activity', { signal }),
    ])
      .then(([nextAgents, nextTeams, nextActivity]) => {
        setAgents(nextAgents)
        setTeams(nextTeams)
        setActivity(nextActivity.agents)
      })
      .catch(() => {
        // The pages stay reachable without the lists.
      })
    return () => controller.abort()
  }, [open])

  const destinations = useMemo<Destination[]>(() => {
    const teamName = new Map(teams.map((team) => [team.id, team.name]))
    const states = new Map(activity.map((entry) => [entry.agentId, entry]))
    const here =
      location.pathname === '/' ? parseWorkspaceSearch(location.search as never) : undefined
    const hereTeam =
      here?.team ?? agents.find((agent) => agent.id === here?.agent)?.teamId ?? undefined
    const list: Destination[] = agents.map((agent) => ({
      key: `agent:${agent.id}`,
      group: 'Agents',
      label: agent.name,
      hint: `${teamName.get(agent.teamId) ?? agent.teamId} · ${agentState(states.get(agent.id), undefined).text}`,
      agent,
      search: { agent: agent.id },
    }))
    for (const team of teams) {
      list.push({
        key: `team:${team.id}`,
        group: 'Teams',
        label: team.name,
        hint: 'Members, USER.md, memory',
        search: { team: team.id, panel: 'team' },
      })
    }
    if (hereTeam) {
      const name = teamName.get(hereTeam) ?? hereTeam
      const keep = here?.agent ? { agent: here.agent } : { team: hereTeam }
      list.push(
        {
          key: 'view:connections',
          group: 'Go to',
          label: 'Connections',
          hint: `${name} · who may message whom`,
          search: { ...keep, team: hereTeam, view: 'connections' },
        },
        {
          key: 'view:changes',
          group: 'Go to',
          label: 'Changes',
          hint: `${name} · what changed in the workspace`,
          search: { ...keep, team: hereTeam, view: 'changes' },
        },
        {
          key: 'view:files',
          group: 'Go to',
          label: 'Files',
          hint: `${name} · delivered files`,
          search: { ...keep, team: hereTeam, view: 'files' },
        },
      )
    }
    for (const [label, hint, path] of PAGES) {
      list.push({ key: `page:${path}`, group: 'Manage', label, hint, path })
    }
    return list
  }, [agents, teams, activity, location])

  const shown = filterDestinations(destinations, query)
  const current = Math.min(active, Math.max(shown.length - 1, 0))

  function go(destination: Destination | undefined) {
    if (!destination) return
    onClose()
    if (destination.path) void navigate({ to: destination.path })
    else void navigate({ to: '/', search: destination.search ?? {} })
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-chocolate/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[12vh] z-50 flex max-h-[70vh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-baziu-lg outline-none"
        >
          <DialogPrimitive.Title className="sr-only">Jump to</DialogPrimitive.Title>
          <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              // biome-ignore lint/a11y/noAutofocus: the palette exists to be typed into.
              autoFocus
              aria-label="Jump to"
              role="combobox"
              aria-expanded="true"
              aria-controls="jump-results"
              aria-activedescendant={shown[current] ? `jump-${shown[current].key}` : undefined}
              value={query}
              placeholder="Jump to an agent, team or page"
              onChange={(event) => {
                setQuery(event.target.value)
                setActive(0)
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setActive(Math.min(current + 1, shown.length - 1))
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setActive(Math.max(current - 1, 0))
                } else if (event.key === 'Enter') {
                  event.preventDefault()
                  go(shown[current])
                }
              }}
              className="min-h-0 min-w-0 flex-1 border-0 bg-transparent p-0 text-[0.95rem] shadow-none outline-none focus:bg-transparent focus:shadow-none"
            />
            <kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.7rem] text-muted-foreground">
              Esc
            </kbd>
          </div>
          <div
            id="jump-results"
            role="listbox"
            aria-label="Destinations"
            className="overflow-y-auto p-1.5"
          >
            {shown.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Nothing matches “{query}”.
              </p>
            )}
            {shown.map((destination, index) => (
              <div key={destination.key}>
                {destination.group !== shown[index - 1]?.group && (
                  <div className="px-2.5 pb-1 pt-2 text-[0.7rem] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                    {destination.group}
                  </div>
                )}
                <button
                  type="button"
                  id={`jump-${destination.key}`}
                  role="option"
                  aria-selected={index === current}
                  onMouseMove={() => setActive(index)}
                  onClick={() => go(destination)}
                  className={`unstyled flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm ${
                    index === current ? 'bg-accent text-accent-foreground' : 'text-foreground'
                  }`}
                >
                  {destination.agent && (
                    <AgentAvatar identity={destination.agent.identity} size={24} />
                  )}
                  <span className="font-semibold">{destination.label}</span>
                  <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground">
                    {destination.hint}
                  </span>
                </button>
              </div>
            ))}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
