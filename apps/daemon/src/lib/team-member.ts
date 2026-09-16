import type { BazilionDb } from '../core/db/client.ts'
import { list as listAgents } from '../core/repos/agents.ts'

// Resolving the Team member a coding turn named.
//
// A model knows its teammates by *name*. Requiring an id meant the only way to find one was to go looking
// for it — which a real model did, by reading the agent directories with bash, a workaround that cannot
// exist under container isolation. So the contract accepts what an agent actually knows: a name or an id,
// resolved inside its own Team, with a refusal that names who could be asked.
//
// Shared by the verification and review request capabilities rather than implemented twice: the rule about
// who is a candidate, and about never reaching across Teams, has to be the same in both.

export type MemberResolution = { agentId: string } | { error: string }

export function resolveTeamMember(
  db: BazilionDb,
  input: { teamId: string; requested: string; excludeAgentId: string },
): MemberResolution {
  const wanted = input.requested.trim().toLowerCase()
  const members = listAgents(db).filter(
    (agent) => agent.teamId === input.teamId && agent.status !== 'archived',
  )
  const byId = members.find((agent) => agent.id.toLowerCase() === wanted)
  if (byId) return { agentId: byId.id }
  const byName = members.filter((agent) => agent.name.toLowerCase() === wanted)
  if (byName.length === 1 && byName[0]) return { agentId: byName[0].id }
  const candidates = members
    .filter((agent) => agent.id !== input.excludeAgentId)
    .map((agent) => `${agent.name} (${agent.id})`)
    .join(', ')
  if (byName.length > 1) {
    return {
      error: `more than one Team member is named ${input.requested}; use the id instead. Members: ${candidates}`,
    }
  }
  return {
    error: `no Team member is named ${input.requested}. Members you can ask: ${candidates || '(none)'}`,
  }
}
