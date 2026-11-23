import { Link } from '@tanstack/react-router'
import { PanelLeft } from 'lucide-react'
import { useActivity } from '../../../lib/activity'
import { AgentAvatar } from '../../AgentAvatar'
import { useWorkspace } from '../context'
import { STATE_DOT } from '../state-style'
import { slimTeams } from './order'

/** The rail folded to avatars, beside a full-width view. */
export function SlimRail() {
  const { agents, teams, agent: open, team: inView, search } = useWorkspace()
  const activity = useActivity()
  const sortedTeams = slimTeams(teams, agents, inView?.id)
  return (
    <nav
      aria-label="Agents"
      className="flex h-full w-16 flex-col items-center gap-2 overflow-y-auto rounded-xl border border-border bg-card py-2.5 shadow-baziu-sm"
    >
      <Link
        to="/"
        search={{ ...search, view: undefined, file: undefined, result: undefined }}
        aria-label="Back to the conversation and the full list"
        title="Back to the conversation"
        className="flex size-10 shrink-0 items-center justify-center rounded-xl text-mocha hover:bg-accent hover:text-accent-foreground"
      >
        <PanelLeft className="size-[18px]" aria-hidden="true" />
      </Link>
      {sortedTeams.map((team) => (
        <div key={team.id} className="flex w-full flex-col items-center gap-2">
          <div className="h-px w-8 bg-border" />
          <span
            className={`max-w-14 truncate text-xs font-bold uppercase tracking-[0.06em] ${
              team.id === inView?.id ? 'text-accent-foreground' : 'text-muted-foreground'
            }`}
            title={team.name}
          >
            {team.name}
          </span>
          {agents
            .filter((agent) => agent.teamId === team.id)
            .map((agent) => {
              const state = activity.stateOf(agent.id)
              return (
                <Link
                  key={agent.id}
                  to="/"
                  search={{ agent: agent.id, ...(search.panel ? { panel: search.panel } : {}) }}
                  aria-label={`${agent.name}: ${state.text}`}
                  title={`${agent.name}: ${state.text}`}
                  className={`relative flex size-10 shrink-0 items-center justify-center rounded-full ${
                    agent.id === open?.agent.id
                      ? 'ring-2 ring-primary ring-offset-2 ring-offset-card'
                      : ''
                  }`}
                >
                  <AgentAvatar identity={agent.identity} size={40} />
                  <span
                    className={`absolute -bottom-px -right-px size-3 rounded-full border-2 border-card ${STATE_DOT[state.kind]}`}
                    aria-hidden="true"
                  />
                </Link>
              )
            })}
        </div>
      ))}
    </nav>
  )
}
