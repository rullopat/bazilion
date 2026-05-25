// Left sidebar: collapsible groups + agent rows + spawn dropdown. Each agent
// row reveals rename (✎) and archive (×) buttons on hover.

import type { Agent, Group, Profile, ProfileGroupWithCount } from '@bazilion/api-types'
import { Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { DEFAULT_GROUP_ID, DEFAULT_PROFILE_ID } from '../lib/wire-constants'
import { CreateGroupDialog } from './CreateGroupDialog'
import { SpawnDialog } from './SpawnDialog'
import { SpawnTeamModal } from './SpawnTeamModal'

interface Props {
  agents: Agent[]
  groups: Group[]
  profiles: Profile[]
  profileGroups: ProfileGroupWithCount[]
  selectedAgentId: string | null
  /** Per-group open/closed map seeded by SSR from the cookie. */
  initialOpenGroups?: Record<string, boolean>
}

// Cookie name shared with the SSR loader in `routes/index.tsx`. Stored as
// URL-encoded JSON of `Record<string, boolean>` — keys are group IDs, values
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
  groups,
  profiles,
  profileGroups,
  selectedAgentId,
  initialOpenGroups,
}: Props) {
  const router = useRouter()
  const [spawnFor, setSpawnFor] = useState<{ profileId: string; groupHint?: string } | null>(null)
  const [spawnTeamFor, setSpawnTeamFor] = useState<ProfileGroupWithCount | null>(null)
  const [createGroupOpen, setCreateGroupOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
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

  // Float the seeded `default` profile + group to the top so new users land
  // on the one-click spawn path.
  const sortedProfiles = [...profiles].sort((a, b) => {
    if (a.id === DEFAULT_PROFILE_ID) return -1
    if (b.id === DEFAULT_PROFILE_ID) return 1
    return 0
  })
  const sortedGroups = [...groups].sort((a, b) => {
    if (a.id === DEFAULT_GROUP_ID) return -1
    if (b.id === DEFAULT_GROUP_ID) return 1
    return 0
  })
  const agentsByGroup = new Map<string, Agent[]>()
  for (const a of agents) {
    const list = agentsByGroup.get(a.groupId) ?? []
    list.push(a)
    agentsByGroup.set(a.groupId, list)
  }

  const selectedGroupId = agents.find((a) => a.id === selectedAgentId)?.groupId ?? null

  return (
    <aside className="flex h-full flex-col rounded-lg border bg-card overflow-hidden">
      <header className="flex items-center justify-between border-b px-3 py-2.5 bg-muted/30">
        <span className="font-serif text-base text-foreground">agents</span>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30"
          >
            + new ▾
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-[calc(100%+0.3rem)] z-20 min-w-[14rem] rounded-md border bg-popover p-1 shadow-md"
              onMouseLeave={() => setMenuOpen(false)}
            >
              {profiles.length === 0 ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">
                  No profiles yet.
                  <br />
                  <a href="/profiles" className="text-primary underline">
                    Create one
                  </a>{' '}
                  to spawn agents.
                </div>
              ) : (
                <>
                  <div className="px-3 pt-1 pb-0.5 text-[0.7em] uppercase tracking-wide text-muted-foreground">
                    spawn agent from template
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
                      className="flex w-full items-center justify-between rounded-sm px-3 py-1.5 text-sm hover:bg-accent"
                    >
                      <span>{p.name || p.id}</span>
                      {p.id === DEFAULT_PROFILE_ID && (
                        <span className="rounded bg-muted px-1 text-[0.7em] text-muted-foreground">
                          default
                        </span>
                      )}
                    </button>
                  ))}
                </>
              )}
              <div className="my-1 h-px bg-border" />
              <div className="px-3 pt-1 pb-0.5 text-[0.7em] uppercase tracking-wide text-muted-foreground">
                spawn group from template
              </div>
              {profileGroups.length === 0 ? (
                <div className="px-3 py-1.5 text-xs text-muted-foreground">
                  No team templates yet.{' '}
                  <a href="/profile-groups" className="text-primary underline">
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
                    disabled={pg.memberCount === 0}
                    title={
                      pg.memberCount === 0
                        ? 'add at least one member before spawning'
                        : undefined
                    }
                    onClick={() => {
                      setMenuOpen(false)
                      setSpawnTeamFor(pg)
                    }}
                    className="flex w-full items-center justify-between rounded-sm px-3 py-1.5 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                  >
                    <span>{pg.name || pg.id}</span>
                    <span className="font-mono text-[0.7em] text-muted-foreground">
                      {pg.memberCount}
                    </span>
                  </button>
                ))
              )}
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false)
                  setCreateGroupOpen(true)
                }}
                className="block w-full text-left rounded-sm px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
              >
                + create group
              </button>
            </div>
          )}
        </div>
      </header>

      <nav className="flex-1 overflow-y-auto p-1">
        {agents.length === 0 && groups.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            No agents yet.{' '}
            <a href="/agents" className="text-primary underline">
              Spawn one
            </a>{' '}
            to start chatting.
          </div>
        ) : (
          sortedGroups.map((g) => {
            const groupAgents = agentsByGroup.get(g.id) ?? []
            const containsSelected = selectedGroupId === g.id
            // Explicit user preference wins; otherwise fall back to the
            // "auto-open if selected or the seeded default group" heuristic.
            const stored = openGroups[g.id]
            const isOpen =
              stored !== undefined ? stored : containsSelected || g.id === DEFAULT_GROUP_ID
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
                className="group/details mb-1 last:mb-0"
              >
                <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-sm px-2 py-1.5 text-xs uppercase tracking-wide text-muted-foreground hover:bg-accent">
                  <span className="w-3 text-xs transition-transform group-open/details:rotate-90 inline-block">
                    ▸
                  </span>
                  <span className="flex-1 truncate font-semibold">{g.name}</span>
                  <span className="font-mono text-xs rounded bg-muted px-1 min-w-[1.4em] text-center">
                    {groupAgents.length}
                  </span>
                </summary>
                {groupAgents.length === 0 ? (
                  <div className="pl-6 py-1 text-xs italic text-muted-foreground">
                    no agents
                  </div>
                ) : (
                  <div className="pl-2">
                    {groupAgents.map((a) => (
                      <div key={a.id} className="group/row relative">
                        <Link
                          to="/"
                          search={{ agent: a.id }}
                          className={`block rounded-sm border-l-2 px-3 py-1.5 pr-14 hover:bg-accent ${
                            a.id === selectedAgentId
                              ? 'border-primary bg-accent'
                              : 'border-transparent'
                          }`}
                        >
                          <div className="truncate text-sm font-medium">{a.name}</div>
                          <div className="flex gap-2 font-mono text-[0.7em] text-muted-foreground">
                            <span className="uppercase tracking-wide">{a.status}</span>
                            <code>{a.id.slice(0, 8)}</code>
                          </div>
                        </Link>
                        <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
                          <button
                            type="button"
                            onClick={() => rename(a)}
                            title="rename"
                            aria-label={`rename ${a.name}`}
                            className="unstyled flex h-6 w-6 items-center justify-center rounded-sm text-mocha-light hover:bg-snow hover:text-sapphire"
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            onClick={() => archive(a)}
                            title="archive"
                            aria-label={`archive ${a.name}`}
                            className="unstyled flex h-6 w-6 items-center justify-center rounded-sm text-mocha-light hover:bg-snow hover:text-[#9B3D3D]"
                          >
                            ×
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
          groupHint={spawnFor.groupHint}
          groups={sortedGroups}
          onClose={() => setSpawnFor(null)}
        />
      )}
      {spawnTeamFor && (
        <SpawnTeamModal
          profileGroup={spawnTeamFor}
          groups={sortedGroups}
          onClose={() => setSpawnTeamFor(null)}
          onSpawned={(slug) => {
            setSpawnTeamFor(null)
            router.navigate({ to: '/groups/$id', params: { id: slug } })
          }}
        />
      )}
      {createGroupOpen && <CreateGroupDialog onClose={() => setCreateGroupOpen(false)} />}
    </aside>
  )
}
