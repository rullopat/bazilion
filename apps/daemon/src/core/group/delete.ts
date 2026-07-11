import type { BazilionDb } from '../db/client.ts'
import type { Paths } from '../paths.ts'
import * as agentRepo from '../repos/agents.ts'
import * as groupRepo from '../repos/groups.ts'
import * as liveHarnessRepo from '../repos/liveHarnesses.ts'

export function deleteGroup(
  db: BazilionDb,
  paths: Paths,
  id: string,
  expectedHarnessRevision?: number,
): void {
  const g = groupRepo.get(db, id, paths)
  if (!g) throw new Error(`group not found: ${id}`)
  const canonical = expectedHarnessRevision !== undefined
  const harness = liveHarnessRepo.get(db, id)
  if (!harness) throw new Error(`group_policy_missing: ${id}`)
  if (canonical && harness.revision !== expectedHarnessRevision) {
    throw new Error(
      `group_revision_conflict: expected ${expectedHarnessRevision}, current ${harness.revision}`,
    )
  }
  if (!canonical) liveHarnessRepo.requireCompatibilityOpen(db, id)

  // ON DELETE RESTRICT on agents.group_id enforces this at the SQL layer,
  // but we surface a friendlier error listing the blocking members.
  const members = agentRepo.list(db, { includeArchived: true }).filter((a) => a.groupId === id)
  if (members.length > 0) {
    const names = members.map((a) => `${a.name} (${a.id.slice(0, 8)})`).join(', ')
    throw new Error(
      `cannot delete group "${id}": ${members.length} agent(s) still belong to it: ${names}. Move or delete them first.`,
    )
  }
  const stagedPath = `${g.path}.deleting-${randomUUID()}`
  const hadSlot = existsSync(g.path)
  if (hadSlot) renameSync(g.path, stagedPath)
  try {
    db.raw.transaction(() => {
      const current = liveHarnessRepo.get(db, id)
      if (!current) throw new Error(`group_policy_missing: ${id}`)
      if (canonical && current.revision !== expectedHarnessRevision) {
        throw new Error(
          `group_revision_conflict: expected ${expectedHarnessRevision}, current ${current.revision}`,
        )
      }
      if (!canonical) liveHarnessRepo.requireCompatibilityOpen(db, id)
      groupRepo.remove(db, id)
    })()
  } catch (error) {
    if (hadSlot && existsSync(stagedPath)) renameSync(stagedPath, g.path)
    throw error
  }
  if (hadSlot && existsSync(stagedPath)) {
    // For linked Groups this removes the renamed symlink only, never its target.
    rmSync(stagedPath, { recursive: true, force: true })
  }
}

import { randomUUID } from 'node:crypto'
import { existsSync, renameSync, rmSync } from 'node:fs'
