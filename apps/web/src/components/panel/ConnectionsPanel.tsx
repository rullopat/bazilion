// The Connections tab: who may message whom in the Team, and what they said lately. The map
// that edits the connections is the full-width view.

import { OUTSIDE_TEAM, type Team, type TeamPolicy } from '@bazilion/api-types'
import { Link } from '@tanstack/react-router'
import { ArrowLeftRight, ArrowRight, Network } from 'lucide-react'
import { useActivity } from '../../lib/activity'
import { api } from '../../lib/api'
import { pairKey, trafficByPair } from '../../lib/messages'
import { useResource } from '../../lib/use-resource'
import { AgentAvatar } from '../AgentAvatar'
import { TeamThread, useTeamMessages } from '../connections/TeamThread'
import { useWorkspace } from '../workspace/context'
import { PanelGroup, PanelHeading } from './SidePanel'

export function ConnectionsPanel({ team }: { team: Team }) {
  const { to, search, agentById } = useWorkspace()
  const { turnsEnded } = useActivity()
  const policy = useResource(
    (signal) => api<TeamPolicy>(`/api/teams/${encodeURIComponent(team.id)}/policy`, { signal }),
    // The map may have saved new connections while this tab was behind it.
    [team.id, search.view],
    { refreshOn: turnsEnded },
  )
  const messages = useTeamMessages(team.id)

  if (policy.error) {
    return (
      <p role="alert" className="err">
        {policy.error}
      </p>
    )
  }
  if (!policy.data) {
    return (
      <p role="status" className="m-0 text-sm text-muted-foreground">
        Loading the connections…
      </p>
    )
  }

  const { mode, edges } = policy.data
  const members = policy.data.members.filter((member) => member.status !== 'archived')
  const traffic = trafficByPair(messages.data ?? [])
  const allows = (from: string, target: string) =>
    edges.some((edge) => edge.from === from && edge.to === target)
  // Connections between teammates, which an open Team keeps but does not use.
  const memberIds = new Set(members.map((member) => member.id))
  const saved = edges.filter((edge) => memberIds.has(edge.from) && memberIds.has(edge.to)).length

  return (
    <div>
      <div className="rounded-2xl border border-border bg-muted/50 px-3 py-2.5">
        <p className="m-0 text-sm font-semibold text-foreground">
          {mode === 'open' ? 'Open Team' : 'Restricted Team'}
        </p>
        <p className="m-0 mt-0.5 text-xs leading-relaxed text-mocha">
          {mode === 'open'
            ? `Every member can message every other member, with no connections needed. Connections here only matter for messages to and from other Teams, or if you make the Team restricted.${
                saved > 0
                  ? ` ${saved} ${saved === 1 ? 'connection between teammates is' : 'connections between teammates are'} saved; ${saved === 1 ? 'it applies' : 'they apply'} once the Team is restricted.`
                  : ''
              }`
            : 'A member can message a teammate only along a connection.'}{' '}
          You can always talk to every Agent.
        </p>
        <Link
          to="/"
          search={to({ view: 'connections', section: undefined })}
          className="btn-primary mt-2.5 min-h-9 w-full py-1.5 text-sm no-underline"
        >
          <Network className="size-4" aria-hidden="true" />
          Open the map
        </Link>
      </div>

      <PanelHeading>Who can message whom</PanelHeading>
      {members.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">This Team has no members yet.</p>
      ) : (
        <PanelGroup>
          {members.map((member) => {
            const reach = [...members.filter((other) => other.id !== member.id), null].flatMap(
              (other) => {
                const id = other?.id ?? OUTSIDE_TEAM
                const out = allows(member.id, id)
                const back = allows(id, member.id)
                // In an open Team teammates need no connection: only other Teams are listed.
                if (mode === 'open' && other) return []
                if (!out && !back) return []
                return [{ id, name: other?.name ?? 'Other teams', out, back }]
              },
            )
            const sent = members.reduce((sum, other) => {
              if (other.id === member.id) return sum
              const pair = traffic.get(pairKey(member.id, other.id))
              if (!pair) return sum
              return sum + (member.id < other.id ? pair.forward : pair.back)
            }, 0)
            return (
              <div key={member.id} className="px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <AgentAvatar identity={agentById(member.id)?.identity} size={22} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                    {member.name}
                  </span>
                  {sent > 0 && (
                    <span className="shrink-0 text-xs text-muted-foreground">{sent} sent</span>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5 pl-[30px]">
                  {mode === 'open' && (
                    <span className="rounded-full bg-frost px-2 py-0.5 text-xs text-chocolate">
                      Everyone in the Team
                    </span>
                  )}
                  {reach.map((entry) => (
                    <span
                      key={entry.id}
                      title={
                        entry.out && entry.back
                          ? `${member.name} and ${entry.name} can message each other`
                          : entry.out
                            ? `${member.name} can message ${entry.name}`
                            : `${entry.name} can message ${member.name}`
                      }
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                        entry.out ? 'bg-accent text-accent-foreground' : 'bg-frost text-foreground'
                      }`}
                    >
                      {entry.out && entry.back ? (
                        <ArrowLeftRight className="size-3" aria-hidden="true" />
                      ) : entry.out ? (
                        <ArrowRight className="size-3" aria-hidden="true" />
                      ) : (
                        <ArrowRight className="size-3 rotate-180" aria-hidden="true" />
                      )}
                      {entry.name}
                    </span>
                  ))}
                  {mode === 'restricted' && reach.length === 0 && (
                    <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning">
                      No connections: it can only talk to you
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </PanelGroup>
      )}

      <PanelHeading>Recent messages</PanelHeading>
      {messages.error ? (
        <p role="alert" className="m-0 text-xs text-danger">
          {messages.error}
        </p>
      ) : (
        <TeamThread messages={messages.data ?? []} limit={12} />
      )}
    </div>
  )
}
