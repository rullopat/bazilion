import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Paths } from '../paths.ts'

export interface DiscoveredSkill {
  name: string
  dir: string
  skillFile: string
}

/**
 * Walk the bazilion skill library and return every directory that contains a
 * SKILL.md file. Pure filesystem read — does not parse the markdown.
 */
export function discoverSkills(paths: Paths): DiscoveredSkill[] {
  if (!existsSync(paths.skillsDir)) return []

  const entries = readdirSync(paths.skillsDir, { withFileTypes: true })
  const skills: DiscoveredSkill[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(paths.skillsDir, entry.name)
    const skillFile = join(dir, 'SKILL.md')
    if (!existsSync(skillFile)) continue
    skills.push({ name: entry.name, dir, skillFile })
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}
