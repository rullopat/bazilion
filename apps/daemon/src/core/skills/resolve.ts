import type { BazilionDb } from '../db/client.ts'
import type { Paths } from '../paths.ts'
import * as agentRepo from '../repos/agents.ts'
import { discoverSkills } from './discover.ts'
import { type ParsedSkill, parseSkillFile } from './parse.ts'

export interface ResolvedSkill {
  name: string
  dir: string
  parsed: ParsedSkill
}

export interface ResolvedSkillSet {
  /** skills attached to the agent that exist and parse correctly */
  resolved: ResolvedSkill[]
  /** attached skill names that are missing from the library or fail to parse */
  missing: { name: string; reason: string }[]
}

/**
 * Given an agent, return the parsed skills currently attached to it. Skill
 * attachments live in `agent_skills`; the source of truth for content is
 * `~/.bazilion/skills/<name>/SKILL.md`.
 */
export function resolveAgentSkills(
  db: BazilionDb,
  paths: Paths,
  agentId: string,
): ResolvedSkillSet {
  const attached = agentRepo.listAttachedSkills(db, agentId)
  const discovered = new Map(discoverSkills(paths).map((s) => [s.name, s]))

  const resolved: ResolvedSkill[] = []
  const missing: { name: string; reason: string }[] = []

  for (const name of attached) {
    const ds = discovered.get(name)
    if (!ds) {
      missing.push({ name, reason: 'not in library' })
      continue
    }
    try {
      const parsed = parseSkillFile(ds.skillFile)
      resolved.push({ name, dir: ds.dir, parsed })
    } catch (err) {
      missing.push({ name, reason: (err as Error).message })
    }
  }
  return { resolved, missing }
}
