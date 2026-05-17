import type { ResolvedAgent } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import type { Paths } from '../paths.ts'
import * as agentRepo from '../repos/agents.ts'
import * as groupRepo from '../repos/groups.ts'
import * as profileRepo from '../repos/profiles.ts'

export function resolveAgent(db: BazilionDb, paths: Paths, agentId: string): ResolvedAgent {
  // `agentRepo.get` accepts either a full UUID or an unambiguous prefix.
  const agent = agentRepo.get(db, agentId)
  if (!agent) throw new Error(`agent not found: ${agentId}`)

  const profile = profileRepo.get(db, agent.profileId)
  if (!profile) {
    throw new Error(`profile not found for agent ${agentId}: ${agent.profileId}`)
  }

  const group = groupRepo.get(db, agent.groupId, paths)
  if (!group) {
    throw new Error(`group not found for agent ${agentId}: ${agent.groupId}`)
  }

  return {
    agent,
    profile,
    model: agent.modelOverride ?? profile.defaultModel,
    reasoningLevel: agent.reasoningLevel,
    group,
    skills: agentRepo.listAttachedSkills(db, agentId),
  }
}
