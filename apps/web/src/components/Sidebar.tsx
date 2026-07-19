// Left sidebar: collapsible teams + agent rows + spawn dropdown.

import type { Agent, Team, TeamTemplateWithCount, Profile } from '@bazilion/api-types'
import { Link, useRouter } from '@tanstack/react-router'
import {
  Archive,
  Bot,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Send,
  UsersRound,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { DEFAULT_TEAM_ID, DEFAULT_PROFILE_ID } from '../lib/wire-constants'
import { CreateTeamDialog } from './CreateTeamDialog'
import { SpawnDialog } from './SpawnDialog'
import { SpawnTeamModal } from './SpawnTeamModal'

interface Props {
  agents: Agent[]
  teams: Team[]
  profiles: Profile[]
  profileGroups: TeamTemplateWithCount[]
  selectedAgentId: string | null
  /** Per-team open/closed map seeded by SSR from the cookie. */
  initialOpenGroups?: Record<string, boolean>
}

// Cookie name shared with the SSR loader in `routes/index.tsx`. Stored as
// URL-encoded JSON of `Record<string, boolean>` — keys are team IDs, values
// are the user's explicit open/closed preference. Used over localStorage so
// the SSR render lands with the correct state and the user never sees a flash
// of default state before hydration corrects it.
export const SIDEBAR_OPEN_GROUPS_COOKIE = 'bz_sidebar_open_groups'

function writeOpenGroupsCookie(map: Record<string, boolean>): void {
  if (typeof document === 'undefined') return
  const value = encodeURIComponent(JSON.stringify(map))
  // 1-year retention, Path=/ so every route sees it, Lax for default safety.
  document.cookie = `${SIDEBAR_OPEN_GROUPS_COOKIE}=${value}; Path=/; Max-Age=31536000; SameSite=Lax`
}

export function Sidebar({
  agents,
  teams,
  profiles,
  profileGroups,
  selectedAgentId,
  initialOpenGroups,
}: Props) {
  const router = useRouter()
  const [spawnFor, setSpawnFor] = useState<{ profileId: string; teamHint?: string } | null>(null)
  const [spawnTeamFor, setSpawnTeamFor] = useState<TeamTemplateWithCount | null>(null)
  const [createGroupOpen, setCreateGroupOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const newButtonRef = useRef<HTMLButtonElement | null>(null)
  const restoreNewButton = () => window.requestAnimationFrame(() => newButtonRef.current?.focus())
  // Seeded by SSR from the cookie so the first paint matches the user's
  // saved preferences — no flash of default state.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(
    () => initialOpenGroups ?? {},
  )

  async function rename(a: Agent) {
    const next = window.prompt(`rename "${a.name}" to:`, a.name)?.trim()
    if (!next || next === a.name) return
    const res = await fetch(`/api/agents/${a.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: next }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      alert(body?.error ?? res.statusText)
      return
    }
    await router.invalidate()
  }
  async function archive(a: Agent) {
    if (!confirm(`archive "${a.name}"? (reversible — find under "show archived")`)) return
    const res = await fetch(`/api/agents/${a.id}/archive`, { method: 'POST' })
    if (!res.ok && res.status !== 204) {
      alert(res.statusText)
      return
    }
    await router.invalidate()
  }

  // Float the seeded `default` profile + team to the top so new users land
  // on the one-click spawn path.
  const sortedProfiles = [...profiles].sort((a, b) => {
    if (a.id === DEFAULT_PROFILE_ID) return -1
    if (b.id === DEFAULT_PROFILE_ID) return 1
    return 0
  })
  const sortedGroups = [...teams].sort((a, b) => {
    if (a.id === DEFAULT_TEAM_ID) return -1
    if (b.id === DEFAULT_TEAM_ID) return 1
    return 0
  })
  const agentsByGroup = new Map<string, Agent[]>()
  for (const a of agents) {
    const list = agentsByGroup.get(a.teamId) ?? []
    list.push(a)
    agentsByGroup.set(a.teamId, list)
  }

  const selectedTeamId = agents.find((a) => a.id === selectedAgentId)?.teamId ?? null

  return (
    <aside className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-baziu-sm">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className="flex size-7 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <Bot className="size-4" aria-hidden="true" />
            </span>
            <span>Agents</span>
          </div>
          <p className="mt-0.5 truncate pl-9 text-[0.7rem] text-muted-foreground">
            {agents.length} agent{agents.length === 1 ? '' : 's'} across {teams.length} team
            {teams.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="relative">
          <button
            ref={newButtonRef}
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className="unstyled inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold text-foreground shadow-baziu-sm transition-colors hover:border-primary/30 hover:bg-accent hover:text-accent-foreground"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            New
            <ChevronDown
              className={`size-3.5 text-muted-foreground transition-transform ${menuOpen ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-[calc(100%+0.4rem)] z-20 w-60 overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-baziu-lg"
              onMouseLeave={() => setMenuOpen(false)}
            >
              {profiles.length === 0 ? (
                <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
                  No Agent templates yet.{' '}
                  <a href="/templates/agents" className="text-primary underline">
                    Create one to spawn agents.
                  </a>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-1.5 px-2.5 pb-1 pt-1 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    <Bot className="size-3" aria-hidden="true" />
                    Agent templates
                  </div>
                  {sortedProfiles.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false)
                        setSpawnFor({ profileId: p.id })
                      }}
                      className="unstyled flex min-h-8 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <Bot className="size-3.5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{p.name || p.id}</span>
                      {p.id === DEFAULT_PROFILE_ID && (
                        <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[0.65rem] font-semibold text-muted-foreground">
                          Default
                        </span>
                      )}
                    </button>
                  ))}
                </>
              )}
              <div className="my-1.5 h-px bg-border" />
              <div className="flex items-center gap-1.5 px-2.5 pb-1 pt-1 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                <UsersRound className="size-3" aria-hidden="true" />
                Team templates
              </div>
              {profileGroups.length === 0 ? (
                <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
                  No team templates yet.{' '}
                  <a href="/templates/teams" className="text-primary underline">
                    Create one
                  </a>
                  .
                </div>
              ) : (
                profileGroups.map((pg) => (
                  <button
                    key={pg.id}
                    type="button"
                    role="menuitem"
                    disabled={pg.slotCount === 0}
                    title={
                      pg.slotCount === 0
                        ? 'Add at least one member before spawning'
                        : undefined
                    }
                    onClick={() => {
                      setMenuOpen(false)
                      setSpawnTeamFor(pg)
                    }}
                    className="unstyled flex min-h-8 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <UsersRound className="size-3.5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{pg.name || pg.id}</span>
                    <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-muted px-1.5 font-mono text-[0.68rem] text-muted-foreground">
                      {pg.slotCount}
                    </span>
                  </button>
                ))
              )}
              <div className="my-1.5 h-px bg-border" />
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false)
                  setCreateGroupOpen(true)
                }}
                className="unstyled flex min-h-8 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <Plus className="size-3.5" aria-hidden="true" />
                Create a team
              </button>
            </div>
          )}
        </div>
      </header>

      <nav className="flex-1 overflow-y-auto p-1.5" aria-label="Teams and agents">
        {agents.length === 0 && teams.length === 0 ? (
          <div className="m-1 flex flex-col items-center rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-center">
            <span className="mb-2 flex size-9 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <Bot className="size-4" aria-hidden="true" />
            </span>
            <p className="text-sm font-semibold text-foreground">No agents yet</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Spawn your first agent to start a conversation.
            </p>
            <a
              href="/agents"
              className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80"
            >
              Open agent setup
              <ChevronRight className="size-3.5" aria-hidden="true" />
            </a>
          </div>
        ) : (
          sortedGroups.map((g) => {
            const teamAgents = agentsByGroup.get(g.id) ?? []
            const containsSelected = selectedTeamId === g.id
            // Explicit user preference wins; otherwise fall back to the
            // "auto-open if selected or the seeded default team" heuristic.
            const stored = openGroups[g.id]
            const isOpen =
              stored !== undefined ? stored : containsSelected || g.id === DEFAULT_TEAM_ID
            return (
              <details
                key={g.id}
                open={isOpen}
                onToggle={(e) => {
                  const next = (e.currentTarget as HTMLDetailsElement).open
                  if (openGroups[g.id] === next) return
                  const merged = { ...openGroups, [g.id]: next }
                  // Write the cookie synchronously BEFORE setState so any
                  // subsequent navigation/loader-fetch in the same tick sees
                  // the new value, and invalidate the route so TanStack
                  // Router's cached loader data refreshes from the cookie.
                  writeOpenGroupsCookie(merged)
                  setOpenGroups(merged)
                  void router.invalidate()
                }}
                className="team/details mb-1 last:mb-0"
              >
                <summary
                  className={`flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground ${
                    containsSelected ? 'bg-muted/60 text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  <ChevronRight
                    className="size-3.5 shrink-0 transition-transform team-open/details:rotate-90"
                    aria-hidden="true"
                  />
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <UsersRound className="size-3" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{g.name}</span>
                  {g.id === DEFAULT_TEAM_ID && (
                    <span className="text-[0.62rem] font-semibold uppercase tracking-wide text-muted-foreground">
                      Default
                    </span>
                  )}
                  <span className="inline-flex min-w-6 items-center justify-center rounded-full border border-border bg-card px-1.5 font-mono text-[0.68rem] text-muted-foreground">
                    {teamAgents.length}
                  </span>
                </summary>
                {teamAgents.length === 0 ? (
                  <div className="py-2 pl-12 pr-2 text-xs text-muted-foreground">
                    No agents in this team
                  </div>
                ) : (
                  <div className="space-y-0.5 py-0.5 pl-2">
                    {teamAgents.map((a) => (
                      <div key={a.id} className="team/row relative rounded-lg">
                        <Link
                          to="/"
                          search={{ agent: a.id }}
                          aria-current={a.id === selectedAgentId ? 'page' : undefined}
                          className={`block min-h-11 rounded-lg border border-transparent py-1.5 pl-2.5 pr-[4.6rem] transition-colors hover:bg-accent/70 ${
                            a.id === selectedAgentId
                              ? 'border-primary/20 bg-accent text-accent-foreground shadow-baziu-sm'
                              : 'text-foreground'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 text-sm font-medium">
                            <span
                              className={`size-1.5 shrink-0 rounded-full ${
                                a.id === selectedAgentId ? 'bg-primary' : 'bg-border'
                              }`}
                              aria-hidden="true"
                            />
                            <span className="min-w-0 flex-1 truncate">{a.name}</span>
                            {a.telegramTopicId !== null && (
                              <span
                                className="shrink-0 text-primary"
                                title={`Telegram topic #${a.telegramTopicId}`}
                                aria-label={`Bound to Telegram topic ${a.telegramTopicId}`}
                              >
                                <Send className="size-3" aria-hidden="true" />
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex gap-2 pl-3 font-mono text-[0.65rem] text-muted-foreground">
                            <span className="uppercase tracking-wide">{a.status}</span>
                            <span>{a.id.slice(0, 8)}</span>
                          </div>
                        </Link>
                        <div className="absolute right-1 top-1/2 z-10 flex -translate-y-1/2 gap-0.5">
                          <button
                            type="button"
                            onClick={() => rename(a)}
                            title="Rename"
                            aria-label={`Rename ${a.name}`}
                            className="unstyled flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-card hover:text-primary focus-visible:bg-card"
                          >
                            <Pencil className="size-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => archive(a)}
                            title="Archive"
                            aria-label={`Archive ${a.name}`}
                            className="unstyled flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive"
                          >
                            <Archive className="size-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </details>
            )
          })
        )}
      </nav>

      {spawnFor && (
        <SpawnDialog
          profileId={spawnFor.profileId}
          teamHint={spawnFor.teamHint}
          teams={sortedGroups}
          onClose={() => { setSpawnFor(null); restoreNewButton() }}
        />
      )}
      {spawnTeamFor && (
        <SpawnTeamModal
          profileGroup={spawnTeamFor}
          teams={sortedGroups}
          onClose={() => { setSpawnTeamFor(null); restoreNewButton() }}
          onSpawned={(slug) => {
            setSpawnTeamFor(null)
            router.navigate({ to: '/teams/$id', params: { id: slug } })
          }}
        />
      )}
      {createGroupOpen && <CreateTeamDialog onClose={() => { setCreateGroupOpen(false); restoreNewButton() }} />}
    </aside>
  )
}
