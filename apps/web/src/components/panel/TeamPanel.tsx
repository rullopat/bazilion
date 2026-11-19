// The Team tab: who is in the Team and what each is doing, what the Team knows about the
// operator (USER.md), what it remembers (shared memory), and its settings.

import type { MemoryEntry, MemoryHit, Team } from '@bazilion/api-types'
import { Link, useRouter } from '@tanstack/react-router'
import { ChevronRight, Plus, Settings2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useActivity } from '../../lib/activity'
import { api } from '../../lib/api'
import { useResource } from '../../lib/use-resource'
import { AgentAvatar } from '../AgentAvatar'
import { SpawnDialog } from '../SpawnDialog'
import { SpawnTeamModal } from '../SpawnTeamModal'
import { useWorkspace } from '../workspace/context'
import { STATE_DOT } from '../workspace/Rail'
import { PanelGroup, PanelHeading } from './SidePanel'

const SMALL_ACTION =
  'inline-flex h-7 items-center gap-1 rounded-[10px] border border-border bg-card px-2 text-xs font-semibold text-foreground hover:border-sapphire-light hover:text-sapphire'

export function TeamPanel({ team }: { team: Team }) {
  const { agents, profiles, teams, teamTemplates, agent: open, to, search } = useWorkspace()
  const activity = useActivity()
  const router = useRouter()
  const [spawning, setSpawning] = useState(false)
  const [templateId, setTemplateId] = useState<string | null>(null)
  const members = agents.filter((agent) => agent.teamId === team.id)
  const eligible = teamTemplates.filter((template) => template.slots.length > 0)
  const template = eligible.find((entry) => entry.id === templateId)

  return (
    <div>
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold text-foreground">{team.name}</div>
          <p className="m-0 truncate font-mono text-xs text-muted-foreground" title={team.path}>
            {team.path}
          </p>
        </div>
        <Link
          to="/"
          search={to({ panel: 'connections', section: undefined })}
          title={
            team.policyMode === 'open'
              ? 'Members message each other freely'
              : 'Members message each other only along connections'
          }
          className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-semibold text-mocha hover:border-sapphire-light hover:text-sapphire"
        >
          {team.policyMode === 'open' ? 'Open' : 'Restricted'}
        </Link>
      </div>

      <div className="mt-5 flex items-center justify-between gap-2">
        <PanelHeading>
          {members.length} member{members.length === 1 ? '' : 's'}
        </PanelHeading>
        <button
          type="button"
          className={`unstyled ${SMALL_ACTION}`}
          onClick={() => setSpawning(true)}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Add agent
        </button>
      </div>
      {members.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-3 py-4 text-sm text-muted-foreground">
          <p className="m-0">No Agents in this Team yet.</p>
          {eligible.length > 0 && (
            <label className="mb-0 mt-3 text-xs">
              Or spawn a whole Team template here
              <select value="" onChange={(event) => setTemplateId(event.target.value || null)}>
                <option value="">Choose a Team template…</option>
                {eligible.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name} ({entry.slots.length} member{entry.slots.length === 1 ? '' : 's'})
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      ) : (
        <PanelGroup>
          {members.map((member) => {
            const state = activity.stateOf(member.id)
            const current = member.id === open?.agent.id
            return (
              <Link
                key={member.id}
                to="/"
                search={{ agent: member.id, panel: 'team' }}
                aria-current={current ? 'true' : undefined}
                className={`flex min-h-12 items-center gap-2.5 px-3 py-2 text-foreground hover:bg-accent/50 ${
                  current ? 'bg-accent/40' : ''
                }`}
              >
                <AgentAvatar identity={member.identity} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{member.name}</span>
                  <span className="flex min-w-0 items-center gap-1.5 text-xs text-mocha">
                    <span
                      className={`size-[7px] shrink-0 rounded-full ${STATE_DOT[state.kind]}`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 truncate">{state.text}</span>
                  </span>
                </span>
                {!current && (
                  <ChevronRight
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
              </Link>
            )
          })}
        </PanelGroup>
      )}

      <div className="mt-5 flex items-center justify-between gap-2">
        <PanelHeading>USER.md</PanelHeading>
        <Link to="/" search={to({ panel: 'team', section: 'user-md' })} className={SMALL_ACTION}>
          Edit
        </Link>
      </div>
      {team.userMd.trim() ? (
        <Link
          to="/"
          search={to({ panel: 'team', section: 'user-md' })}
          className="block rounded-2xl border border-border bg-muted/50 px-3 py-2.5 hover:border-sapphire-light"
        >
          <span className="line-clamp-5 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-chocolate">
            {team.userMd.trim()}
          </span>
        </Link>
      ) : (
        <p className="m-0 rounded-2xl border border-dashed border-border bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
          Empty. Tell this Team's Agents who you are and how you like to work; every member reads it
          on every turn.
        </p>
      )}

      <MemoryGlance key={`${team.id}:${search.section ?? ''}`} team={team} />

      <PanelHeading>Settings</PanelHeading>
      <PanelGroup>
        <Link
          to="/"
          search={to({ panel: 'team', section: 'settings' })}
          className="flex min-h-11 items-center gap-2.5 px-3 py-2 text-foreground hover:bg-accent/50"
        >
          <Settings2 className="size-4 shrink-0 text-mocha" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Workspace and templates</span>
            <span className="block truncate text-xs text-muted-foreground">
              Sandbox defaults, Telegram topic names, save as a template
            </span>
          </span>
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Link>
      </PanelGroup>

      {spawning && (
        <SpawnDialog
          profiles={profiles}
          teams={teams}
          teamId={team.id}
          onClose={() => setSpawning(false)}
        />
      )}
      {template && (
        <SpawnTeamModal
          template={template}
          teams={[team]}
          initialTeamId={team.id}
          onClose={() => setTemplateId(null)}
          onSpawned={() => {
            setTemplateId(null)
            void router.invalidate()
          }}
        />
      )}
    </div>
  )
}

interface NoteRow {
  key: string
  preview: string
}

/** The Team's memory at a glance: how many notes, a search, and the notes changed last. */
function MemoryGlance({ team }: { team: Team }) {
  const { to } = useWorkspace()
  const { turnsEnded } = useActivity()
  const base = `/api/teams/${encodeURIComponent(team.id)}/memory`
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 200)
    return () => clearTimeout(timer)
  }, [query])

  const notes = useResource(
    async (signal): Promise<{ rows: NoteRow[]; total: number | null }> => {
      if (debounced) {
        const hits = await api<MemoryHit[]>(
          `${base}/search?q=${encodeURIComponent(debounced)}&limit=8`,
          { signal },
        )
        return { rows: hits.map((hit) => ({ key: hit.key, preview: hit.snippet })), total: null }
      }
      const entries = await api<MemoryEntry[]>(base, { signal })
      const newest = [...entries].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5)
      return {
        rows: newest.map((entry) => ({ key: entry.key, preview: entry.content.slice(0, 120) })),
        total: entries.length,
      }
    },
    [base, debounced, turnsEnded],
  )
  const total = notes.data?.total

  return (
    <>
      <div className="mt-5 flex items-center justify-between gap-2">
        <PanelHeading>
          Shared memory
          {typeof total === 'number' ? ` · ${total} note${total === 1 ? '' : 's'}` : ''}
        </PanelHeading>
        <Link
          to="/"
          search={to({ panel: 'team', section: 'memory', note: undefined })}
          className={SMALL_ACTION}
        >
          Open
        </Link>
      </div>
      <input
        type="search"
        aria-label="Search the Team's memory"
        placeholder="Search the notes"
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="mb-2 min-h-9 py-1.5 text-sm"
      />
      {notes.error ? (
        <p role="alert" className="m-0 text-xs text-danger">
          {notes.error}
        </p>
      ) : !notes.data ? (
        <p role="status" className="m-0 text-xs text-muted-foreground">
          Loading…
        </p>
      ) : notes.data.rows.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">
          {debounced
            ? 'No note matches.'
            : 'No notes yet. Agents write here what the whole Team should remember.'}
        </p>
      ) : (
        <PanelGroup>
          {notes.data.rows.map((row) => (
            <Link
              key={row.key}
              to="/"
              search={to({ panel: 'team', section: 'memory', note: row.key })}
              className="block px-3 py-2 hover:bg-accent/50"
            >
              <span className="block truncate font-mono text-xs font-medium text-foreground">
                {row.key}
              </span>
              {row.preview && (
                <span className="mt-0.5 line-clamp-2 break-words text-xs leading-snug text-mocha">
                  {row.preview}
                </span>
              )}
            </Link>
          ))}
        </PanelGroup>
      )}
    </>
  )
}
