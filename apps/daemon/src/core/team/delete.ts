import { randomUUID } from 'node:crypto'
import { existsSync, renameSync, rmSync } from 'node:fs'
import type { BazilionDb } from '../db/client.ts'
import { DomainError } from '../errors.ts'
import type { Paths } from '../paths.ts'
import * as agentRepo from '../repos/agents.ts'
import * as teamRepo from '../repos/teams.ts'

export function deleteTeam(db: BazilionDb, paths: Paths, id: string): void {
  const g = teamRepo.get(db, id, paths)
  if (!g) throw new DomainError(404, `team not found: ${id}`)

  // ON DELETE RESTRICT on agents.team_id enforces this at the SQL layer,
  // but we surface a friendlier error listing the blocking members.
  const members = agentRepo.list(db, { includeArchived: true }).filter((a) => a.teamId === id)
  if (members.length > 0) {
    const names = members.map((a) => `${a.name} (${a.id.slice(0, 8)})`).join(', ')
    throw new DomainError(
      400,
      `cannot delete team "${id}": ${members.length} agent(s) still belong to it: ${names}. Move or delete them first.`,
    )
  }
  const stagedPath = `${g.path}.deleting-${randomUUID()}`
  const hadSlot = existsSync(g.path)
  if (hadSlot) renameSync(g.path, stagedPath)
  try {
    teamRepo.remove(db, id)
  } catch (error) {
    if (hadSlot && existsSync(stagedPath)) renameSync(stagedPath, g.path)
    throw error
  }
  if (hadSlot && existsSync(stagedPath)) {
    // For linked Teams this removes the renamed symlink only, never its target.
    rmSync(stagedPath, { recursive: true, force: true })
  }
}
