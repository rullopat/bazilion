import { rmSync } from 'node:fs'
import {
  type Agent,
  OUTSIDE_TEAM,
  type TeamPolicy,
  type TeamTemplate,
  type TeamTemplateEndpoint,
} from '@bazilion/api-types'
import { spawnAgent } from '../agent/spawn.ts'
import { type BazilionDb, inTx } from '../db/client.ts'
import { DomainError } from '../errors.ts'
import type { Paths } from '../paths.ts'
import { validateSlug } from '../profile/validate.ts'
import * as agentRepo from '../repos/agents.ts'
import * as teamPolicyRepo from '../repos/teamPolicies.ts'
import * as teamRepo from '../repos/teams.ts'
import * as teamTemplateRepo from '../repos/teamTemplates.ts'
import { registerTeam } from '../team/register.ts'

/**
 * Spawn one Agent per template slot into `teamId` and add the template's edges between
 * them. An unknown `teamId` becomes a new Team with the template's USER.md and mode; an
 * existing Team keeps its USER.md and mode.
 */
export function spawnTeamTemplate(
  db: BazilionDb,
  paths: Paths,
  input: { templateId: string; teamId: string; userMd?: string },
): { agents: Agent[]; team: TeamPolicy } {
  const template = teamTemplateRepo.get(db, input.templateId)
  if (!template) throw new DomainError(404, `team template not found: ${input.templateId}`)
  validateSlug(input.teamId)
  const newTeam = teamRepo.get(db, input.teamId, paths) === null
  const created: Agent[] = []
  let teamCreated = false
  try {
    inTx(db, () => {
      if (newTeam) {
        const userMd = input.userMd ?? template.userMd ?? undefined
        registerTeam(
          db,
          { id: input.teamId, ...(userMd ? { userMd } : {}), policyMode: template.policyMode },
          paths,
        )
        teamCreated = true
      }
      const names = new Set(
        agentRepo
          .list(db, { includeArchived: true })
          .filter((agent) => agent.teamId === input.teamId)
          .map((agent) => agent.name),
      )
      for (const slot of template.slots) {
        const name = uniqueName(slot.agentName, names)
        names.add(name)
        created.push(
          spawnAgent(db, paths, {
            profileId: slot.profileId,
            name,
            modelOverride: slot.modelOverride,
            reasoningLevel: slot.reasoningLevel ?? 'medium',
            teamId: input.teamId,
          }),
        )
      }
      const member = (end: TeamTemplateEndpoint): string => {
        if (end === OUTSIDE_TEAM) return OUTSIDE_TEAM
        const agent = created[end]
        if (!agent) throw new Error(`template edge names a missing slot: ${end}`)
        return agent.id
      }
      teamPolicyRepo.insertEdges(
        db,
        input.teamId,
        template.edges.map((edge) => ({ from: member(edge.from), to: member(edge.to) })),
      )
    })
  } catch (error) {
    // The transaction rolled back the rows; remove only the directories this call created.
    // registerTeam removes its own slot when it fails, and never touches one already on disk.
    try {
      for (const agent of created) rmSync(agent.dir, { recursive: true, force: true })
      if (teamCreated) rmSync(paths.teamDir(input.teamId), { recursive: true, force: true })
    } catch (cleanup) {
      console.warn(`team template spawn cleanup failed: ${(cleanup as Error).message}`)
    }
    throw error
  }
  const team = teamPolicyRepo.get(db, input.teamId)
  if (!team) throw new Error(`team not found: ${input.teamId}`)
  return { agents: created, team }
}

/** Capture a live Team (members, edges, mode, USER.md) as a new template. */
export function saveTeamAsTemplate(
  db: BazilionDb,
  paths: Paths,
  teamId: string,
  input: { id: string; name: string },
): TeamTemplate {
  const team = teamRepo.get(db, teamId, paths)
  const policy = teamPolicyRepo.get(db, teamId)
  if (!team || !policy) throw new DomainError(404, `team not found: ${teamId}`)
  const position = new Map(policy.members.map((agent, index) => [agent.id, index]))
  const endpoint = (end: string): TeamTemplateEndpoint =>
    end === OUTSIDE_TEAM ? OUTSIDE_TEAM : (position.get(end) ?? -1)
  return teamTemplateRepo.create(db, input.id, {
    name: input.name,
    userMd: team.userMd,
    policyMode: team.policyMode,
    slots: policy.members.map((agent) => ({
      profileId: agent.profileId,
      agentName: agent.name,
      modelOverride: agent.modelOverride,
      reasoningLevel: agent.reasoningLevel,
    })),
    edges: policy.edges.map((edge) => ({ from: endpoint(edge.from), to: endpoint(edge.to) })),
  })
}

function uniqueName(base: string, existing: ReadonlySet<string>): string {
  if (!existing.has(base)) return base
  let suffix = 2
  while (existing.has(`${base}-${suffix}`)) suffix++
  return `${base}-${suffix}`
}
