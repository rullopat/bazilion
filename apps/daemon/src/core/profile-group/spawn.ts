import { readdirSync, rmSync } from 'node:fs'
import type { ProfileGroupSlot } from '@bazilion/api-types'
import { spawnAgent } from '../agent/spawn.ts'
import type { BazilionDb } from '../db/client.ts'
import { inTx } from '../db/client.ts'
import { registerGroup } from '../group/register.ts'
import type { Paths } from '../paths.ts'
import { DEFAULT_GROUP_ID } from '../profile/seed.ts'
import * as groupRepo from '../repos/groups.ts'
import * as profileGroupRepo from '../repos/profileGroups.ts'
import * as profileRepo from '../repos/profiles.ts'
import { rmWithRetry } from './rm-with-retry.ts'

export interface SpawnProfileGroupInput {
  profileGroupId: string
  /** Target group slug. Falls back to `groupSlugHint`, then to the default group. */
  groupSlug?: string
  /** Override the template's `userMd` for this spawn only. */
  userMd?: string
}

export interface SpawnProfileGroupResult {
  groupSlug: string
  /** Created agents in spawn order, with their final (post-suffix) names. */
  agents: { id: string; name: string }[]
  /** Empty on success; populated only by `SpawnProfileGroupError`. */
  orphanAgentIds: string[]
}

/**
 * Thrown when the spawn loop fails. The DB transaction is rolled back by
 * the time this is constructed; `orphanAgentIds` lists any agent dirs the
 * cleanup retry helper couldn't remove (typically empty — populated when
 * the filesystem rejects the rmSync after all three retries).
 */
export class SpawnProfileGroupError extends Error {
  override name = 'SpawnProfileGroupError'
  orphanAgentIds: string[]
  override cause: unknown
  constructor(message: string, orphanAgentIds: string[], cause: unknown) {
    super(message)
    this.orphanAgentIds = orphanAgentIds
    this.cause = cause
  }
}

/**
 * Walk slots in `position` order, resolving each `agentName` to a unique
 * final name by appending `-2`, `-3`, ... when taken. The `existing` set
 * starts with whatever agents already live in the target group; resolved
 * names are added back into it so two slots that share an `agentName`
 * collide with each other as well as with pre-existing agents.
 *
 * Pure function — exported so the spawn integration test can target the
 * algorithm directly without orchestrating a full spawn.
 */
export function resolveSlotNames(
  existing: ReadonlySet<string>,
  slots: ProfileGroupSlot[],
): string[] {
  const taken = new Set(existing)
  const out: string[] = []
  for (const slot of slots) {
    let candidate = slot.agentName
    let n = 2
    while (taken.has(candidate)) {
      candidate = `${slot.agentName}-${n}`
      n++
    }
    taken.add(candidate)
    out.push(candidate)
  }
  return out
}

export async function spawnProfileGroup(
  db: BazilionDb,
  paths: Paths,
  input: SpawnProfileGroupInput,
): Promise<SpawnProfileGroupResult> {
  const template = profileGroupRepo.get(db, input.profileGroupId)
  if (!template) {
    throw new Error(`profile group not found: ${input.profileGroupId}`)
  }
  const slots = profileGroupRepo.slots(db, input.profileGroupId)

  // Pre-flight: every referenced profile must still exist. Bail before any
  // side effect rather than discovering it mid-loop.
  const missing: string[] = []
  for (const s of slots) {
    if (!profileRepo.get(db, s.profileId)) missing.push(s.profileId)
  }
  if (missing.length > 0) {
    throw new Error(`profile group spawn: missing profiles: ${missing.join(', ')}`)
  }

  const targetSlug = input.groupSlug ?? template.groupSlugHint ?? DEFAULT_GROUP_ID
  const targetGroupExists = !!groupRepo.get(db, targetSlug, paths)
  const existingNames = new Set<string>(
    targetGroupExists
      ? db.raw
          .query<{ name: string }, [string]>('SELECT name FROM agents WHERE group_id = ?')
          .all(targetSlug)
          .map((r) => r.name)
      : [],
  )
  const resolvedNames = resolveSlotNames(existingNames, slots)

  // Snapshot dir contents so the rollback path can identify fs orphans by
  // diff regardless of whether spawnAgent crashed before or after its DB
  // insert. The agents-dir scan catches the rare mkdir-then-fail window;
  // the groups-dir scan catches a registerGroup that wrote the dir before
  // failing on the INSERT.
  const beforeAgentDirs = new Set(safeReaddir(paths.agentsDir))
  const beforeGroupDirs = new Set(safeReaddir(paths.groupsDir))

  let groupCreated = false
  const created: { id: string; name: string }[] = []
  try {
    inTx(db, () => {
      if (!targetGroupExists) {
        registerGroup(db, { id: targetSlug, name: targetSlug }, paths)
        groupCreated = true
      }
      // Decision #5 (BAZ-002): the existing groups table stores user_md as
      // NOT NULL DEFAULT '', so a pre-existing group's empty user_md is
      // operator-mediated (initial value or explicit clear). Seed only into
      // a group we just created in this same spawn — never overwrite an
      // existing row.
      const seedUserMd = input.userMd ?? template.userMd ?? null
      if (groupCreated && seedUserMd) {
        groupRepo.setUserMd(db, targetSlug, seedUserMd)
      }
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i]
        const name = resolvedNames[i]
        if (!slot || !name) continue
        const agent = spawnAgent(db, paths, {
          profileId: slot.profileId,
          name,
          modelOverride: slot.modelOverride,
          reasoningLevel: slot.reasoningLevel ?? 'medium',
          groupId: targetSlug,
        })
        created.push({ id: agent.id, name: agent.name })
      }
    })
    return { groupSlug: targetSlug, agents: created, orphanAgentIds: [] }
  } catch (err) {
    const newAgentDirs = safeReaddir(paths.agentsDir).filter((d) => !beforeAgentDirs.has(d))
    const orphans: string[] = []
    for (const dir of newAgentDirs) {
      if (!(await rmWithRetry(paths.agentDir(dir)))) {
        orphans.push(dir)
      }
    }
    const newGroupDirs = safeReaddir(paths.groupsDir).filter((d) => !beforeGroupDirs.has(d))
    for (const slug of newGroupDirs) {
      try {
        rmSync(paths.groupDir(slug), { recursive: true, force: true })
      } catch (cleanupErr) {
        console.error(`spawnProfileGroup: failed to clean up group dir ${slug}`, cleanupErr)
      }
    }
    for (const id of orphans) {
      console.error(`spawnProfileGroup: orphan agent dir left on disk: ${paths.agentDir(id)}`)
    }
    const original = err instanceof Error ? err.message : String(err)
    const message =
      orphans.length > 0 ? `${original} (orphan agent dirs: ${orphans.join(', ')})` : original
    throw new SpawnProfileGroupError(message, orphans, err)
  }
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
