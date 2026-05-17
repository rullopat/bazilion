import type { BazilionDb } from '../db/client.ts'
import type { Paths } from '../paths.ts'
import * as agentRepo from '../repos/agents.ts'
import * as groupRepo from '../repos/groups.ts'

export function deleteGroup(db: BazilionDb, paths: Paths, id: string): void {
  const g = groupRepo.get(db, id, paths)
  if (!g) throw new Error(`group not found: ${id}`)

  // ON DELETE RESTRICT on agents.group_id enforces this at the SQL layer,
  // but we surface a friendlier error listing the blocking members.
  const members = agentRepo.list(db, { includeArchived: true }).filter((a) => a.groupId === id)
  if (members.length > 0) {
    const names = members.map((a) => `${a.name} (${a.id.slice(0, 8)})`).join(', ')
    throw new Error(
      `cannot delete group "${id}": ${members.length} agent(s) still belong to it: ${names}. Move or archive them first.`,
    )
  }

  groupRepo.remove(db, id)
}
