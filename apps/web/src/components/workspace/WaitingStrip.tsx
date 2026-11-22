// On a phone the workspace opens on the Agent list, without the overview beside it: this strip
// above the list names the Agents that wait for the operator, so a question is one tap away.

import type { Agent } from '@bazilion/api-types'
import { Link } from '@tanstack/react-router'
import { BellRing } from 'lucide-react'
import { useActivity } from '../../lib/activity'
import { AgentAvatar } from '../AgentAvatar'
import { useWorkspace } from './context'

/** How many Agents the strip names before it points to Attention. */
const SHOWN = 3

export function WaitingStrip({ className = '' }: { className?: string }) {
  const { agents, teams } = useWorkspace()
  const activity = useActivity()
  const waiting = agents
    .map((agent) => ({ agent, state: activity.stateOf(agent.id) }))
    .filter((entry) => entry.state.kind === 'needs')
  if (waiting.length === 0) return null
  const teamName = new Map(teams.map((team) => [team.id, team.name]))
  const more = waiting.length - SHOWN

  return (
    <section
      aria-label="Waiting for you"
      className={`rounded-2xl border border-warning/40 bg-warning/10 px-3 py-2.5 shadow-baziu-sm ${className}`}
    >
      <h2 className="m-0 mb-1.5 flex items-center gap-1.5 font-body text-xs font-bold uppercase tracking-[0.08em] text-warning">
        <BellRing className="size-3.5" aria-hidden="true" />
        Waiting for you
      </h2>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {waiting.slice(0, SHOWN).map(({ agent, state }) => (
          <li key={agent.id}>
            <WaitingRow agent={agent} team={teamName.get(agent.teamId)} text={state.text} />
          </li>
        ))}
      </ul>
      {more > 0 && (
        <Link to="/attention" className="mt-1.5 inline-block text-sm font-semibold">
          {more} more in Attention
        </Link>
      )}
    </section>
  )
}

function WaitingRow({ agent, team, text }: { agent: Agent; team?: string; text: string }) {
  return (
    <Link
      to="/"
      search={{ agent: agent.id }}
      className="flex min-h-11 items-center gap-2.5 rounded-xl px-1.5 py-1 text-foreground hover:bg-card/70"
    >
      <AgentAvatar identity={agent.identity} size={28} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">
          {agent.name}
          {team && <span className="font-normal text-mocha"> · {team}</span>}
        </span>
        <span className="block truncate text-xs text-warning">{text}</span>
      </span>
      <span className="shrink-0 text-xs font-semibold text-accent-foreground">Open</span>
    </Link>
  )
}
