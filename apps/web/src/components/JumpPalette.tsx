// "Jump to": one box that opens any Agent, Team, conversation, view or page, or runs an action.
// Opened from the top bar or with ⌘K / Ctrl+K; it loads what it lists when it opens, so it works
// on every page. What waits for you comes first, then what is working, then the actions.

import type {
  ActivityResponse,
  Agent,
  AgentActivity,
  ConversationListResponse,
  Profile,
  Team,
} from '@bazilion/api-types'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { Keyboard, MessageSquarePlus, Moon, Search, Sun, UserPlus } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { agentState, shortTime } from '../lib/activity'
import { api } from '../lib/api'
import { NEW_CONVERSATION_EVENT } from '../lib/shortcuts'
import { setThemeMode } from '../lib/theme'
import { parseWorkspaceSearch, type WorkspaceSearch } from '../lib/workspace'
import { AgentAvatar } from './AgentAvatar'
import { SpawnDialog } from './SpawnDialog'

type Group =
  | 'Waiting for you'
  | 'Working now'
  | 'Actions'
  | 'Agents'
  | 'Recent conversations'
  | 'Teams'
  | 'Go to'
  | 'Manage'

interface Destination {
  key: string
  group: Group
  label: string
  hint: string
  agent?: Agent
  icon?: ReactNode
  /** A workspace address, a page path, or something to do. */
  search?: WorkspaceSearch
  path?: string
  run?: () => void
}

const PAGES: Array<[label: string, hint: string, path: string]> = [
  ['Attention', 'Decisions and failures waiting for you', '/attention'],
  ['Agents', 'Every Agent by Team: archive, move, delete', '/agents'],
  ['Teams', 'Create and remove Teams', '/teams'],
  ['Agent templates', 'What a new Agent starts with', '/templates/agents'],
  ['Team templates', 'Rosters that spawn a whole Team', '/templates/teams'],
  ['Skills', 'Import, review and remove prompt skills', '/skills'],
  ['Setup', 'Models, tools, MCP, Telegram, access, system', '/config'],
]

/** How many Agents' conversations are looked at for "Recent conversations", and how many shown. */
const RECENT_AGENTS = 3
const RECENT_CONVERSATIONS = 5

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

/**
 * Agents in the palette's order: those waiting for you, then those working, then the rest by when
 * they were last active, most recent first.
 */
export function orderAgents<T extends { id: string }>(
  agents: readonly T[],
  activity: ReadonlyMap<string, AgentActivity>,
): { waiting: T[]; working: T[]; rest: T[] } {
  const kind = (agent: T) => agentState(activity.get(agent.id), undefined).kind
  const last = (agent: T) => activity.get(agent.id)?.lastActivityAt ?? 0
  return {
    waiting: agents.filter((agent) => kind(agent) === 'needs'),
    working: agents.filter((agent) => kind(agent) === 'working'),
    rest: agents
      .filter((agent) => kind(agent) !== 'needs' && kind(agent) !== 'working')
      .toSorted((a, b) => last(b) - last(a)),
  }
}

interface Recent {
  id: string
  agentId: string
  title: string
  updatedAt: number
  /** The one new turns write to. */
  selected: boolean
}

export function JumpPalette({
  open,
  onClose,
  onShowShortcuts,
}: {
  open: boolean
  onClose: () => void
  onShowShortcuts: () => void
}) {
  const navigate = useNavigate()
  const location = useRouterState({ select: (state) => state.location })
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [agents, setAgents] = useState<Agent[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [activity, setActivity] = useState<AgentActivity[]>([])
  const [recent, setRecent] = useState<Recent[]>([])
  const [dark, setDark] = useState(false)
  const [spawning, setSpawning] = useState(false)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    setDark(document.documentElement.classList.contains('dark'))
    const controller = new AbortController()
    const signal = controller.signal
    Promise.all([
      api<Agent[]>('/api/agents', { signal }),
      api<Team[]>('/api/teams', { signal }),
      api<ActivityResponse>('/api/activity', { signal }),
      api<Profile[]>('/api/profiles', { signal }),
    ])
      .then(async ([nextAgents, nextTeams, nextActivity, nextProfiles]) => {
        setAgents(nextAgents)
        setTeams(nextTeams)
        setActivity(nextActivity.agents)
        setProfiles(nextProfiles)
        const latest = nextActivity.agents
          .filter((entry) => entry.lastActivityAt !== null)
          .toSorted((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0))
          .slice(0, RECENT_AGENTS)
        const lists = await Promise.all(
          latest.map((entry) =>
            api<ConversationListResponse>(
              `/api/agents/${encodeURIComponent(entry.agentId)}/conversations?limit=3`,
              { signal },
            ).then((list) =>
              list.conversations.map(
                (conversation): Recent => ({
                  id: conversation.id,
                  agentId: entry.agentId,
                  title: conversation.title,
                  updatedAt: conversation.updatedAt,
                  selected: conversation.id === list.selectedId,
                }),
              ),
            ),
          ),
        )
        setRecent(
          lists
            .flat()
            .toSorted((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, RECENT_CONVERSATIONS),
        )
      })
      .catch(() => {
        // The pages and actions stay reachable without the lists.
      })
    return () => controller.abort()
  }, [open])

  const destinations = useMemo<Destination[]>(() => {
    const teamName = new Map(teams.map((team) => [team.id, team.name]))
    const byAgent = new Map(activity.map((entry) => [entry.agentId, entry]))
    const agentById = new Map(agents.map((agent) => [agent.id, agent]))
    const here =
      location.pathname === '/' ? parseWorkspaceSearch(location.search as never) : undefined
    const hereAgent = here?.agent ? agentById.get(here.agent) : undefined
    const hereTeam = here?.team ?? hereAgent?.teamId ?? undefined
    const agentDestination = (agent: Agent, group: Group): Destination => ({
      key: `agent:${agent.id}`,
      group,
      label: agent.name,
      hint: `${teamName.get(agent.teamId) ?? agent.teamId} · ${agentState(byAgent.get(agent.id), undefined).text}`,
      agent,
      search: { agent: agent.id },
    })
    const ordered = orderAgents(agents, byAgent)
    const list: Destination[] = [
      ...ordered.waiting.map((agent) => agentDestination(agent, 'Waiting for you')),
      ...ordered.working.map((agent) => agentDestination(agent, 'Working now')),
    ]

    // Actions: what is done most from here.
    if (hereAgent && !here?.view) {
      list.push({
        key: 'action:new-conversation',
        group: 'Actions',
        label: `New conversation with ${hereAgent.name}`,
        hint: 'The current one stays in its list',
        icon: <MessageSquarePlus className="size-4" aria-hidden="true" />,
        run: () =>
          window.dispatchEvent(
            new CustomEvent(NEW_CONVERSATION_EVENT, { detail: { agentId: hereAgent.id } }),
          ),
      })
    }
    list.push(
      {
        key: 'action:spawn',
        group: 'Actions',
        label: 'Add an Agent',
        hint: hereTeam ? `To ${teamName.get(hereTeam) ?? hereTeam}, or another Team` : 'To a Team',
        icon: <UserPlus className="size-4" aria-hidden="true" />,
        run: () => setSpawning(true),
      },
      {
        key: 'action:theme',
        group: 'Actions',
        label: dark ? 'Switch to the light theme' : 'Switch to the dark theme',
        hint: 'For this browser',
        icon: dark ? (
          <Sun className="size-4" aria-hidden="true" />
        ) : (
          <Moon className="size-4" aria-hidden="true" />
        ),
        run: () => setThemeMode(dark ? 'light' : 'dark'),
      },
      {
        key: 'action:shortcuts',
        group: 'Actions',
        label: 'Keyboard shortcuts',
        hint: 'Press ? anywhere',
        icon: <Keyboard className="size-4" aria-hidden="true" />,
        run: onShowShortcuts,
      },
    )

    list.push(...ordered.rest.map((agent) => agentDestination(agent, 'Agents')))
    for (const conversation of recent) {
      const agent = agentById.get(conversation.agentId)
      if (!agent) continue
      list.push({
        key: `conversation:${conversation.id}`,
        group: 'Recent conversations',
        label: conversation.title,
        hint: `${agent.name} · ${shortTime(conversation.updatedAt)}`,
        agent,
        search: conversation.selected
          ? { agent: agent.id }
          : { agent: agent.id, conversation: conversation.id },
      })
    }
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
  }, [agents, teams, activity, recent, location, dark, onShowShortcuts])

  const shown = filterDestinations(destinations, query)
  const current = Math.min(active, Math.max(shown.length - 1, 0))
  const hereTeam =
    location.pathname === '/'
      ? (parseWorkspaceSearch(location.search as never).team ??
        agents.find((agent) => agent.id === parseWorkspaceSearch(location.search as never).agent)
          ?.teamId)
      : undefined

  function go(destination: Destination | undefined) {
    if (!destination) return
    onClose()
    if (destination.run) destination.run()
    else if (destination.path) void navigate({ to: destination.path })
    else void navigate({ to: '/', search: destination.search ?? {} })
  }

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-chocolate/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed left-1/2 top-[12vh] z-50 flex max-h-[70vh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-baziu-lg outline-none"
          >
            <DialogPrimitive.Title className="sr-only">
              Jump to or do anything
            </DialogPrimitive.Title>
            <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input
                // biome-ignore lint/a11y/noAutofocus: the palette exists to be typed into.
                autoFocus
                aria-label="Jump to or do anything"
                role="combobox"
                aria-expanded="true"
                aria-controls="jump-results"
                aria-activedescendant={shown[current] ? `jump-${shown[current].key}` : undefined}
                value={query}
                placeholder="An Agent, a Team, a page, or something to do"
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
                // The palette's frame is the focus mark; the field's own ring would sit inside it.
                style={{ outline: 'none' }}
                className="min-h-0 min-w-0 flex-1 border-0 bg-transparent p-0 text-base shadow-none focus:bg-transparent focus:shadow-none"
              />
              <kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                Esc
              </kbd>
            </div>
            <div
              id="jump-results"
              role="listbox"
              aria-label="Destinations and actions"
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
                    <div
                      className={`px-2.5 pb-1 pt-2 text-xs font-bold uppercase tracking-[0.08em] ${
                        destination.group === 'Waiting for you'
                          ? 'text-warning'
                          : 'text-muted-foreground'
                      }`}
                    >
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
                    {destination.agent ? (
                      <AgentAvatar identity={destination.agent.identity} size={24} />
                    ) : destination.icon ? (
                      <span className="flex size-6 shrink-0 items-center justify-center text-mocha">
                        {destination.icon}
                      </span>
                    ) : null}
                    <span className="min-w-0 truncate font-semibold">{destination.label}</span>
                    <span className="ml-auto min-w-0 shrink truncate pl-3 text-xs text-muted-foreground">
                      {destination.hint}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      {spawning && (
        <SpawnDialog
          profiles={profiles}
          teams={teams}
          teamId={hereTeam}
          onClose={() => setSpawning(false)}
        />
      )}
    </>
  )
}
