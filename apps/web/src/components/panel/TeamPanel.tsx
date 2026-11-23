// The Team tab: who is in the Team and what each is doing, what the Team knows about the
// operator (USER.md), what it remembers (shared memory), and its settings.

import type { MemoryEntry, MemoryHit, Team } from '@bazilion/api-types'
import { Link, useRouter } from '@tanstack/react-router'
import { ChevronRight, Plus, Settings2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useActivity } from '../../lib/activity'
import { api } from '../../lib/api'
import { markdownPreview, markdownTitle } from '../../lib/markdown-text'
import { useResource } from '../../lib/use-resource'
import { AgentAvatar } from '../AgentAvatar'
import { SpawnDialog } from '../SpawnDialog'
import { SpawnTeamModal } from '../SpawnTeamModal'
import { SelectMenu } from '../ui/form'
import { SearchField } from '../ui/parts'
import { useWorkspace } from '../workspace/context'
import { STATE_DOT } from '../workspace/state-style'
import { PanelGroup, PanelHeading } from './SidePanel'

const SMALL_ACTION =
  'inline-flex h-7 items-center gap-1 rounded-[10px] border border-border bg-card px-2 text-xs font-semibold text-foreground hover:border-sapphire-light hover:text-sapphire'

export function TeamPanel({ team }: { team: Team }) {
  const { agents, profiles, teams, teamTemplates, agent: open, to, search } = useWorkspace()
  const { turnsEnded } = useActivity()
  // Agents write USER.md too: read it again after every turn and when a sheet closes.
  const fresh = useResource(
    (signal) => api<Team>(`/api/teams/${encodeURIComponent(team.id)}`, { signal }),
    [team.id, search.section],
    { refreshOn: turnsEnded },
  )
  const userMd = fresh.data?.id === team.id ? fresh.data.userMd : team.userMd
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

      {/* A Team on its own lists its members in the middle; the panel does not repeat them. */}
      {(open || (members.length === 0 && eligible.length > 0)) && (
        <>
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
              Add an Agent
            </button>
          </div>
          {members.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-3 py-4 text-sm text-muted-foreground">
              <p className="m-0">No Agents in this Team yet.</p>
              {eligible.length > 0 && (
                <div className="mt-3">
                  <span className="mb-1.5 block text-xs">Or start it from a Team template</span>
                  <SelectMenu
                    ariaLabel="Start from a Team template"
                    value=""
                    placeholder="Choose a Team template…"
                    options={eligible.map((entry) => ({
                      value: entry.id,
                      label: entry.name,
                      hint: `${entry.slots.length} member${entry.slots.length === 1 ? '' : 's'}`,
                    }))}
                    onChange={(value) => setTemplateId(value || null)}
                  />
                </div>
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
        </>
      )}

      <div className="mt-5 flex items-center justify-between gap-2">
        <PanelHeading>About you · USER.md</PanelHeading>
        <Link to="/" search={to({ panel: 'team', section: 'user-md' })} className={SMALL_ACTION}>
          Edit
        </Link>
      </div>
      {userMd.trim() ? (
        <Link
          to="/"
          search={to({ panel: 'team', section: 'user-md' })}
          className="block rounded-2xl border border-border bg-muted/50 px-3 py-2.5 hover:border-sapphire-light"
        >
          <span className="line-clamp-4 break-words text-sm leading-relaxed text-chocolate">
            {markdownPreview(userMd, 320) || userMd.trim()}
          </span>
        </Link>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
          <p className="m-0">
            Tell this Team’s Agents who you are and how you like to work. Every member reads it on
            every turn, and fills it in as it learns about you.
          </p>
          <Link
            to="/"
            search={to({ panel: 'team', section: 'user-md' })}
            className={`mt-2.5 ${SMALL_ACTION}`}
          >
            Write it
          </Link>
        </div>
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
  title: string
  preview: string
}

const noteRow = (key: string, text: string): NoteRow => ({
  key,
  title: markdownTitle(text) ?? key.split('/').pop()?.replace(/\.md$/, '') ?? key,
  preview: markdownPreview(text, 120),
})

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
        return { rows: hits.map((hit) => noteRow(hit.key, hit.snippet)), total: null }
      }
      const entries = await api<MemoryEntry[]>(base, { signal })
      const newest = [...entries].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5)
      return {
        rows: newest.map((entry) => noteRow(entry.key, entry.content)),
        total: entries.length,
      }
    },
    [base, debounced],
    { refreshOn: turnsEnded },
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
      <SearchField
        label="Search the Team's memory"
        placeholder="Search the notes"
        value={query}
        onChange={setQuery}
        className="mb-2"
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
              <span className="block truncate text-sm font-semibold text-foreground">
                {row.title}
              </span>
              <span className="block truncate font-mono text-xs text-muted-foreground">
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
