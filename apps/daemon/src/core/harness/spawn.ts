import { randomUUID } from 'node:crypto'
import { readdirSync, rmSync } from 'node:fs'
import type { Agent, ResolvedGroupHarness } from '@bazilion/api-types'
import { spawnAgent } from '../agent/spawn.ts'
import type { BazilionDb } from '../db/client.ts'
import { inTx } from '../db/client.ts'
import { registerGroup } from '../group/register.ts'
import type { Paths } from '../paths.ts'
import { rmWithRetry } from '../profile-group/rm-with-retry.ts'
import * as agentRepo from '../repos/agents.ts'
import * as groupRepo from '../repos/groups.ts'
import * as harnessTemplateRepo from '../repos/harnessTemplates.ts'
import * as liveHarnessRepo from '../repos/liveHarnesses.ts'
import * as profileRepo from '../repos/profiles.ts'

export interface SpawnHarnessTemplateInput {
  templateId: string
  templateExpectedRevision: number
  groupId: string
  groupExpectedRevision?: number
  mode: 'initialize' | 'append'
  userMd?: string
}

export interface SpawnHarnessTemplateResult {
  agents: Agent[]
  group: ResolvedGroupHarness
}

export interface SpawnHarnessTemplatePreview {
  mode: 'initialize' | 'append'
  groupId: string
  currentRevision: number | null
  resultingRevision: number
  newMembers: Array<{ slotId: string; agentName: string; profileId: string }>
  edges: Array<{
    sourceKind: 'user' | 'outside_group' | 'agent'
    sourceId: string | null
    targetKind: 'user' | 'outside_group' | 'agent'
    targetId: string | null
  }>
}

export function previewHarnessTemplateSpawn(
  db: BazilionDb,
  paths: Paths,
  input: SpawnHarnessTemplateInput,
): SpawnHarnessTemplatePreview {
  const source = harnessTemplateRepo.get(db, input.templateId)
  if (!source) throw new Error(`team template not found: ${input.templateId}`)
  if (source.deletedAt !== null) throw new Error(`template_deleted: ${input.templateId}`)
  if (source.currentRevision !== input.templateExpectedRevision) {
    throw new Error(
      `template_revision_conflict: expected ${input.templateExpectedRevision}, current ${source.currentRevision}`,
    )
  }
  const snapshot = harnessTemplateRepo.revision(db, source.id, input.templateExpectedRevision)
  if (!snapshot)
    throw new Error(`template_snapshot_missing: ${source.id}@${source.currentRevision}`)
  const existingGroup = groupRepo.get(db, input.groupId, paths)
  const harness = existingGroup ? liveHarnessRepo.get(db, input.groupId) : null
  if (existingGroup && !input.groupExpectedRevision) {
    throw new Error('group_revision_required: groupExpectedRevision is required')
  }
  if (harness && harness.revision !== input.groupExpectedRevision) {
    throw new Error(
      `group_revision_conflict: expected ${input.groupExpectedRevision}, current ${harness.revision}`,
    )
  }
  const members = existingGroup
    ? agentRepo
        .list(db, { includeArchived: true })
        .filter((agent) => agent.groupId === input.groupId)
    : []
  if (!existingGroup && input.mode !== 'initialize') {
    throw new Error('initialize_required: a new Group must establish a baseline')
  }
  if (
    existingGroup &&
    input.mode === 'append' &&
    members.length === 0 &&
    !harness?.baselineInstantiationId
  ) {
    throw new Error('initialize_required: empty uninitialized Group must establish a baseline')
  }
  if (input.mode === 'initialize') {
    if (members.length > 0) throw new Error('group_not_empty: initialize requires an empty Group')
    if (harness?.baselineInstantiationId) {
      throw new Error('baseline_replacement_required: empty Group retains a baseline')
    }
  }
  const slotEndpoint = (slotId: string | null) => (slotId ? `new:${slotId}` : null)
  const newEdges = snapshot.edges.map((edge) => ({
    sourceKind: edge.sourceKind === 'slot' ? ('agent' as const) : edge.sourceKind,
    sourceId: edge.sourceKind === 'slot' ? slotEndpoint(edge.sourceId) : null,
    targetKind: edge.targetKind === 'slot' ? ('agent' as const) : edge.targetKind,
    targetId: edge.targetKind === 'slot' ? slotEndpoint(edge.targetId) : null,
  }))
  return {
    mode: input.mode,
    groupId: input.groupId,
    currentRevision: harness?.revision ?? null,
    resultingRevision: harness ? harness.revision + 1 : 1,
    newMembers: snapshot.slots.map((slot) => ({
      slotId: slot.slotId,
      agentName: slot.agentName,
      profileId: slot.profileId,
    })),
    edges: [...(existingGroup ? liveHarnessRepo.edges(db, input.groupId) : []), ...newEdges],
  }
}

export class SpawnHarnessTemplateError extends Error {
  override name = 'SpawnHarnessTemplateError'
  readonly orphanAgentIds: string[]
  override readonly cause: unknown
  constructor(message: string, orphanAgentIds: string[], cause: unknown) {
    super(message)
    this.orphanAgentIds = orphanAgentIds
    this.cause = cause
  }
}

export async function spawnHarnessTemplate(
  db: BazilionDb,
  paths: Paths,
  input: SpawnHarnessTemplateInput,
): Promise<SpawnHarnessTemplateResult> {
  const source = harnessTemplateRepo.get(db, input.templateId)
  if (!source) throw new Error(`team template not found: ${input.templateId}`)
  if (source.deletedAt !== null) throw new Error(`template_deleted: ${input.templateId}`)
  if (source.currentRevision !== input.templateExpectedRevision) {
    throw new Error(
      `template_revision_conflict: expected ${input.templateExpectedRevision}, current ${source.currentRevision}`,
    )
  }
  const snapshot = harnessTemplateRepo.revision(db, source.id, input.templateExpectedRevision)
  if (!snapshot)
    throw new Error(`template_snapshot_missing: ${source.id}@${source.currentRevision}`)
  for (const slot of snapshot.slots) {
    if (!profileRepo.get(db, slot.profileId)) {
      throw new Error(`profile not found: ${slot.profileId}`)
    }
  }
  const existingGroup = groupRepo.get(db, input.groupId, paths)
  if (existingGroup && !input.groupExpectedRevision) {
    throw new Error('group_revision_required: groupExpectedRevision is required')
  }
  const beforeAgentDirs = new Set(safeReaddir(paths.agentsDir))
  const beforeGroupDirs = new Set(safeReaddir(paths.groupsDir))
  const created: Agent[] = []
  try {
    inTx(db, () => {
      const transactionalSource = harnessTemplateRepo.get(db, input.templateId)
      if (!transactionalSource || transactionalSource.deletedAt !== null) {
        throw new Error(`template_deleted: ${input.templateId}`)
      }
      if (transactionalSource.currentRevision !== input.templateExpectedRevision) {
        throw new Error(
          `template_revision_conflict: expected ${input.templateExpectedRevision}, current ${transactionalSource.currentRevision}`,
        )
      }
      const groupCreated = !existingGroup
      if (groupCreated) registerGroup(db, { id: input.groupId, name: input.groupId }, paths)
      const harness = liveHarnessRepo.get(db, input.groupId)
      if (!harness) throw new Error(`group_policy_missing: ${input.groupId}`)
      if (!groupCreated && harness.revision !== input.groupExpectedRevision) {
        throw new Error(
          `group_revision_conflict: expected ${input.groupExpectedRevision}, current ${harness.revision}`,
        )
      }
      const memberCount = agentRepo
        .list(db, { includeArchived: true })
        .filter((agent) => agent.groupId === input.groupId).length
      if (groupCreated && input.mode !== 'initialize') {
        throw new Error('initialize_required: a new Group must establish a baseline')
      }
      if (
        !groupCreated &&
        input.mode === 'append' &&
        memberCount === 0 &&
        harness.baselineInstantiationId === null
      ) {
        throw new Error('initialize_required: empty uninitialized Group must establish a baseline')
      }
      if (input.mode === 'initialize') {
        if (memberCount > 0) throw new Error('group_not_empty: initialize requires an empty Group')
        if (harness.baselineInstantiationId !== null) {
          throw new Error('baseline_replacement_required: empty Group retains a baseline')
        }
      }
      if (groupCreated && (input.userMd ?? snapshot.userMd)) {
        groupRepo.setUserMd(db, input.groupId, input.userMd ?? snapshot.userMd ?? '')
      }
      const existingNames = new Set(
        agentRepo
          .list(db, { includeArchived: true })
          .filter((agent) => agent.groupId === input.groupId)
          .map((agent) => agent.name),
      )
      for (const slot of snapshot.slots) {
        const name = uniqueName(slot.agentName, existingNames)
        existingNames.add(name)
        created.push(
          spawnAgent(db, paths, {
            profileId: slot.profileId,
            name,
            modelOverride: slot.modelOverride,
            reasoningLevel: slot.reasoningLevel ?? 'medium',
            groupId: input.groupId,
            deferHarnessUpdate: true,
          }),
        )
      }
      const instantiationId = randomUUID()
      db.raw.run(
        `INSERT INTO template_instantiations
           (id, group_id, template_id, template_revision, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [instantiationId, input.groupId, source.id, snapshot.revision, Date.now()],
      )
      const agentBySlot = new Map<string, Agent>()
      for (let index = 0; index < snapshot.slots.length; index++) {
        const slot = snapshot.slots[index]
        const agent = created[index]
        if (!slot || !agent) throw new Error('template_snapshot_invalid: slot mapping missing')
        agentBySlot.set(slot.slotId, agent)
        db.raw.run(
          `INSERT INTO source_slot_bindings (agent_id, instantiation_id, source_slot_id)
           VALUES (?, ?, ?)`,
          [agent.id, instantiationId, slot.slotId],
        )
        liveHarnessRepo.insertAgentState(db, input.groupId, agent.id)
      }
      for (const edge of snapshot.edges) {
        const sourceId =
          edge.sourceKind === 'slot' ? agentBySlot.get(edge.sourceId ?? '')?.id : null
        const targetId =
          edge.targetKind === 'slot' ? agentBySlot.get(edge.targetId ?? '')?.id : null
        if (
          (edge.sourceKind === 'slot' && !sourceId) ||
          (edge.targetKind === 'slot' && !targetId)
        ) {
          throw new Error('template_snapshot_invalid: edge slot mapping missing')
        }
        db.raw.run(
          `INSERT INTO live_harness_edges
             (group_id, source_kind, source_id, target_kind, target_id)
           VALUES (?, ?, ?, ?, ?)`,
          [
            input.groupId,
            edge.sourceKind === 'slot' ? 'agent' : edge.sourceKind,
            sourceId ?? '',
            edge.targetKind === 'slot' ? 'agent' : edge.targetKind,
            targetId ?? '',
          ],
        )
      }
      if (input.mode === 'initialize') {
        db.raw.run('UPDATE live_harnesses SET baseline_instantiation_id = ? WHERE group_id = ?', [
          instantiationId,
          input.groupId,
        ])
      }
      if (groupCreated) {
        db.raw.run(
          `UPDATE live_harnesses SET membership_mode = 'explicit', updated_at = ? WHERE group_id = ?`,
          [Date.now(), input.groupId],
        )
      } else {
        liveHarnessRepo.bumpExplicit(db, input.groupId)
      }
    })
    const group = liveHarnessRepo.detail(db, input.groupId)
    if (!group) throw new Error(`group_policy_missing: ${input.groupId}`)
    return { agents: created, group }
  } catch (error) {
    const orphans: string[] = []
    for (const dir of safeReaddir(paths.agentsDir).filter((name) => !beforeAgentDirs.has(name))) {
      if (!(await rmWithRetry(paths.agentDir(dir)))) orphans.push(dir)
    }
    for (const slug of safeReaddir(paths.groupsDir).filter((name) => !beforeGroupDirs.has(name))) {
      try {
        rmSync(paths.groupDir(slug), { recursive: true, force: true })
      } catch {}
    }
    throw new SpawnHarnessTemplateError((error as Error).message, orphans, error)
  }
}

function uniqueName(base: string, existing: ReadonlySet<string>): string {
  if (!existing.has(base)) return base
  let suffix = 2
  while (existing.has(`${base}-${suffix}`)) suffix++
  return `${base}-${suffix}`
}

function safeReaddir(path: string): string[] {
  try {
    return readdirSync(path)
  } catch {
    return []
  }
}
