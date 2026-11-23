// What the middle of the workspace shows when nothing is open: across every Team, what waits for
// the operator, what is being worked on, the Teams themselves, the latest files, and the Agents
// that were active last. Built from the same parts as a Team's own overview (TeamHome).

import type { Agent, Team } from '@bazilion/api-types'
import { Link } from '@tanstack/react-router'
import { BellRing, Plus } from 'lucide-react'
import { useState } from 'react'
import { type AgentState, shortTime, teamSummary, useActivity } from '../../lib/activity'
import { useAttentionCount } from '../../lib/attention-count'
import { useHydrated } from '../../lib/use-resource'
import { AgentAvatar } from '../AgentAvatar'
import { Button } from '../Button'
import { ResultTile } from '../files/ResultTile'
import { useResults } from '../files/use-results'
import { SpawnDialog } from '../SpawnDialog'
import { useWorkspace } from './context'
import { STATE_DOT, STATE_TEXT } from './state-style'

const HEADING =
  'm-0 mb-2 mt-7 font-body text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground'
const ROW =
  'flex min-h-14 items-center gap-3 rounded-2xl border border-border bg-card px-3.5 py-2 text-foreground shadow-baziu-sm hover:border-sapphire-light hover:bg-accent/30'
/** How many Agents "Recently active" lists. */
const RECENT = 5

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`

export function Overview() {
  const { agents, teams, profiles, search } = useWorkspace()
  const activity = useActivity()
  const attention = useAttentionCount()
  const [spawning, setSpawning] = useState(false)
  // Times are written in the browser's own format, which the server cannot know.
  const hydrated = useHydrated()
  const files = useResults('', {}, 4)
  const teamName = new Map(teams.map((team) => [team.id, team.name]))
  const states = new Map(agents.map((agent) => [agent.id, activity.stateOf(agent.id)]))
  const stateOf = (agent: Agent): AgentState => states.get(agent.id) ?? { kind: 'idle', text: '' }
  const waiting = agents.filter((agent) => stateOf(agent).kind === 'needs')
  const working = agents.filter((agent) => stateOf(agent).kind === 'working')
  const busy = new Set([...waiting, ...working].map((agent) => agent.id))
  const recent = agents
    .filter((agent) => !busy.has(agent.id))
    .map((agent) => ({ agent, at: activity.byAgent.get(agent.id)?.lastActivityAt ?? null }))
    .filter((entry): entry is { agent: Agent; at: number } => entry.at !== null)
    .sort((a, b) => b.at - a.at)
    .slice(0, RECENT)
  // Attention items that are not an Agent's question or command (lesson proposals, failures).
  const elsewhere = Math.max(attention.open - attention.agentWaits, 0)
  const summary = teamSummary([...states.values()])

  const agentRow = (agent: Agent, trailing?: string) => {
    const state = stateOf(agent)
    return (
      <li key={agent.id}>
        <Link
          to="/"
          search={{ agent: agent.id, ...(search.panel ? { panel: search.panel } : {}) }}
          className={ROW}
        >
          <AgentAvatar identity={agent.identity} size={36} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold">
              {agent.name}
              <span className="font-normal text-mocha"> · {teamName.get(agent.teamId)}</span>
            </span>
            <span
              className={`mt-0.5 flex min-w-0 items-center gap-1.5 text-xs ${STATE_TEXT[state.kind]}`}
            >
              <span
                className={`size-[7px] shrink-0 rounded-full ${STATE_DOT[state.kind]}`}
                aria-hidden="true"
              />
              <span className="min-w-0 truncate">{state.text}</span>
            </span>
          </span>
          {trailing && <span className="shrink-0 text-xs text-mocha">{trailing}</span>}
          <span className="shrink-0 text-xs font-semibold text-accent-foreground">Open</span>
        </Link>
      </li>
    )
  }

  return (
    <section
      aria-label="Overview"
      className="flex h-full flex-col overflow-y-auto rounded-[16px] border border-border bg-card px-4 py-5 shadow-baziu-sm sm:px-8 sm:py-8"
    >
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="m-0 font-display text-[1.9rem] leading-tight text-charcoal">Overview</h1>
        <p className="m-0 mt-1 text-sm text-mocha">
          {plural(agents.length, 'Agent')} in {plural(teams.length, 'Team')}
          {summary ? ` · ${summary}` : ''}
        </p>

        <h2 className={HEADING}>Waiting for you</h2>
        {waiting.length > 0 ? (
          <ul className="m-0 list-none space-y-2 p-0">{waiting.map((agent) => agentRow(agent))}</ul>
        ) : (
          <p className="m-0 rounded-2xl border border-dashed border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            No Agent is waiting for you.
          </p>
        )}
        {elsewhere > 0 && (
          <Link
            to="/attention"
            className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold"
          >
            <BellRing className="size-3.5" aria-hidden="true" />
            {plural(elsewhere, 'more item')} in Attention
          </Link>
        )}

        {working.length > 0 && (
          <>
            <h2 className={HEADING}>Working now</h2>
            <ul className="m-0 list-none space-y-2 p-0">
              {working.map((agent) => agentRow(agent))}
            </ul>
          </>
        )}

        <h2 className={HEADING}>Teams</h2>
        <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
          {teams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              members={agents.filter((agent) => agent.teamId === team.id)}
              summary={teamSummary(agents.filter((agent) => agent.teamId === team.id).map(stateOf))}
            />
          ))}
        </ul>
        {agents.length === 0 && (
          <div className="mt-4">
            <Button variant="primary" onClick={() => setSpawning(true)}>
              <Plus className="size-4" aria-hidden="true" />
              Add your first Agent
            </Button>
          </div>
        )}

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
                  open={{ team: result.teamId, view: 'files', result: result.id }}
                />
              ))}
            </div>
          </>
        )}

        {recent.length > 0 && (
          <>
            <h2 className={HEADING}>Recently active</h2>
            <ul className="m-0 list-none space-y-2 p-0">
              {recent.map(({ agent, at }) => agentRow(agent, hydrated ? shortTime(at) : undefined))}
            </ul>
          </>
        )}
      </div>
      {spawning && (
        <SpawnDialog
          profiles={profiles}
          teams={teams}
          teamId={teams[0]?.id ?? 'default'}
          onClose={() => setSpawning(false)}
        />
      )}
    </section>
  )
}

function TeamCard({ team, members, summary }: { team: Team; members: Agent[]; summary: string }) {
  return (
    <li>
      <Link
        to="/"
        search={{ team: team.id }}
        className="flex h-full min-h-16 items-center gap-3 rounded-2xl border border-border bg-muted/40 px-3.5 py-2.5 text-foreground hover:border-sapphire-light hover:bg-accent/30"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold">{team.name}</span>
          <span className="block truncate text-xs text-mocha">
            {plural(members.length, 'member')}
            {summary ? ` · ${summary}` : ''}
          </span>
        </span>
        <span className="flex shrink-0 -space-x-2" aria-hidden="true">
          {members.slice(0, 4).map((member) => (
            <span key={member.id} className="rounded-full ring-2 ring-card">
              <AgentAvatar identity={member.identity} size={26} />
            </span>
          ))}
        </span>
      </Link>
    </li>
  )
}
