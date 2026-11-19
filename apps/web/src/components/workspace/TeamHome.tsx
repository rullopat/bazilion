// What the middle of the workspace shows when a Team is in view and no Agent is open: the Team's
// members to pick from, each with what it is doing.

import type { Team } from '@bazilion/api-types'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Code2, Images, Network, Plus } from 'lucide-react'
import { useState } from 'react'
import { teamSummary, useActivity } from '../../lib/activity'
import { AgentAvatar } from '../AgentAvatar'
import { Button } from '../Button'
import { TeamThread, useTeamMessages } from '../connections/TeamThread'
import { ResultTile } from '../files/ResultTile'
import { useResults } from '../files/use-results'
import { SpawnDialog } from '../SpawnDialog'
import { useWorkspace } from './context'
import { useTeamCounts } from './counts'
import { STATE_DOT } from './Rail'

const VIEWS = [
  { view: 'connections', label: 'Connections', icon: Network },
  { view: 'changes', label: 'Changes', icon: Code2 },
  { view: 'files', label: 'Files', icon: Images },
] as const

const HEADING =
  'm-0 mb-2 mt-7 font-body text-[0.72rem] font-bold uppercase tracking-[0.08em] text-muted-foreground'

export function TeamHome({ team }: { team: Team }) {
  const { agents, profiles, teams, search } = useWorkspace()
  const activity = useActivity()
  const [spawning, setSpawning] = useState(false)
  const members = agents.filter((agent) => agent.teamId === team.id)
  const summary = teamSummary(members.map((member) => activity.stateOf(member.id)))
  const counts = useTeamCounts(team.id)
  const files = useResults(team.id, {}, 4)
  const messages = useTeamMessages(team.id, 50)
  return (
    <section
      aria-label={team.name}
      className="flex h-full flex-col overflow-y-auto rounded-[16px] border border-border bg-card px-4 py-5 shadow-baziu-sm sm:px-8 sm:py-8"
    >
      <div className="mx-auto w-full max-w-2xl">
        <Link
          to="/"
          search={{}}
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold lg:hidden"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          All teams
        </Link>
        <h1 className="m-0 font-display text-[1.9rem] leading-tight text-charcoal">{team.name}</h1>
        <p className="m-0 mt-1 text-sm text-mocha">
          {members.length} member{members.length === 1 ? '' : 's'}
          {summary ? ` · ${summary}` : ''}
        </p>

        {members.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-border bg-muted/40 px-5 py-8 text-center">
            <p className="m-0 text-sm font-semibold text-foreground">No Agents in this Team yet</p>
            <p className="m-0 mt-1 text-sm text-muted-foreground">
              Add the first one to start a conversation.
            </p>
            <Button variant="primary" className="mt-4" onClick={() => setSpawning(true)}>
              <Plus className="size-4" aria-hidden="true" />
              Add an agent
            </Button>
          </div>
        ) : (
          <>
            <ul className="m-0 mt-5 list-none space-y-2 p-0">
              {members.map((member) => {
                const state = activity.stateOf(member.id)
                return (
                  <li key={member.id}>
                    <Link
                      to="/"
                      search={{
                        agent: member.id,
                        ...(search.panel ? { panel: search.panel } : {}),
                      }}
                      className="flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-card px-3.5 py-2.5 text-foreground shadow-baziu-sm hover:border-sapphire-light hover:bg-accent/30"
                    >
                      <AgentAvatar identity={member.identity} size={40} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.95rem] font-semibold">
                          {member.name}
                        </span>
                        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-mocha">
                          <span
                            className={`size-[7px] shrink-0 rounded-full ${STATE_DOT[state.kind]}`}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 truncate">{state.text}</span>
                        </span>
                      </span>
                      <span className="shrink-0 text-xs font-semibold text-accent-foreground">
                        Open
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
            <div className="mt-4">
              <Button variant="ghost" onClick={() => setSpawning(true)}>
                <Plus className="size-4" aria-hidden="true" />
                Add an agent
              </Button>
            </div>
          </>
        )}

        <div className="mt-8 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {VIEWS.map(({ view, label, icon: Icon }) => (
            <Link
              key={view}
              to="/"
              search={{ team: team.id, view }}
              className="flex min-h-16 items-center gap-2.5 rounded-2xl border border-border bg-muted/50 px-3 py-2.5 text-foreground hover:border-sapphire-light hover:bg-accent/30"
            >
              <Icon className="size-[18px] shrink-0 text-mocha" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{label}</span>
                <span className="block truncate text-xs text-mocha">
                  {view === 'connections'
                    ? `${team.policyMode === 'open' ? 'Open' : 'Restricted'} · ${
                        messages.data?.length
                          ? `${messages.data.length} message${messages.data.length === 1 ? '' : 's'}`
                          : 'no messages yet'
                      }`
                    : view === 'changes'
                      ? counts.changes === null
                        ? 'Not a Git repository'
                        : `${counts.changes} changed file${counts.changes === 1 ? '' : 's'}`
                      : `${counts.files ?? 0} saved file${counts.files === 1 ? '' : 's'}`}
                </span>
              </span>
            </Link>
          ))}
        </div>

        {files.results.length > 0 && (
          <>
            <h2 className={HEADING}>Latest files</h2>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {files.results.map((result) => (
                <ResultTile
                  key={result.id}
                  resultId={result.id}
                  result={result}
                  compact
                  detail={agents.find((agent) => agent.id === result.agentId)?.name}
                  open={{ team: team.id, view: 'files', result: result.id }}
                />
              ))}
            </div>
          </>
        )}

        {(messages.data?.length ?? 0) > 0 && (
          <>
            <h2 className={HEADING}>Lately between its Agents</h2>
            <TeamThread messages={messages.data ?? []} limit={4} />
          </>
        )}
      </div>
      {spawning && (
        <SpawnDialog
          profiles={profiles}
          teams={teams}
          teamId={team.id}
          onClose={() => setSpawning(false)}
        />
      )}
    </section>
  )
}
