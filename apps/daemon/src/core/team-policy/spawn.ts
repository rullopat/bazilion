import { randomUUID } from 'node:crypto'
import { readdirSync, rmSync } from 'node:fs'
import type { Agent, ResolvedTeamPolicy } from '@bazilion/api-types'
import { spawnAgent } from '../agent/spawn.ts'
import type { BazilionDb } from '../db/client.ts'
import { inTx } from '../db/client.ts'
import type { Paths } from '../paths.ts'
import * as agentRepo from '../repos/agents.ts'
import * as profileRepo from '../repos/profiles.ts'
import * as teamPolicyRepo from '../repos/teamPolicies.ts'
import * as teamRepo from '../repos/teams.ts'
import * as teamTemplateRepo from '../repos/teamTemplates.ts'
import { registerTeam } from '../team/register.ts'
import { rmWithRetry } from '../team-policy/rm-with-retry.ts'

export interface SpawnTeamTemplateInput {
  templateId: string
  templateExpectedRevision: number
  teamId: string
  teamExpectedRevision?: number
  mode: 'initialize' | 'append'
  userMd?: string
}

export interface SpawnTeamTemplateResult {
  agents: Agent[]
  team: ResolvedTeamPolicy
}

export interface SpawnTeamTemplatePreview {
  mode: 'initialize' | 'append'
  teamId: string
  currentRevision: number | null
  resultingRevision: number
  newMembers: Array<{ slotId: string; agentName: string; profileId: string }>
  edges: Array<{
    sourceKind: 'user' | 'outside_team' | 'agent'
    sourceId: string | null
    targetKind: 'user' | 'outside_team' | 'agent'
    targetId: string | null
    posture: 'allow' | 'approval_required'
  }>
}

export function previewTeamTemplateSpawn(
  db: BazilionDb,
  paths: Paths,
  input: SpawnTeamTemplateInput,
): SpawnTeamTemplatePreview {
  const source = teamTemplateRepo.get(db, input.templateId)
  if (!source) throw new Error(`team template not found: ${input.templateId}`)
  if (source.deletedAt !== null) throw new Error(`template_deleted: ${input.templateId}`)
  if (source.currentRevision !== input.templateExpectedRevision) {
    throw new Error(
      `template_revision_conflict: expected ${input.templateExpectedRevision}, current ${source.currentRevision}`,
    )
  }
  const snapshot = teamTemplateRepo.revision(db, source.id, input.templateExpectedRevision)
  if (!snapshot)
    throw new Error(`template_snapshot_missing: ${source.id}@${source.currentRevision}`)
  const existingGroup = teamRepo.get(db, input.teamId, paths)
  const teamPolicy = existingGroup ? teamPolicyRepo.get(db, input.teamId) : null
  if (existingGroup && !input.teamExpectedRevision) {
    throw new Error('team_revision_required: teamExpectedRevision is required')
  }
  if (teamPolicy && teamPolicy.revision !== input.teamExpectedRevision) {
    throw new Error(
      `team_revision_conflict: expected ${input.teamExpectedRevision}, current ${teamPolicy.revision}`,
    )
  }
  const members = existingGroup
    ? agentRepo.list(db, { includeArchived: true }).filter((agent) => agent.teamId === input.teamId)
    : []
  if (!existingGroup && input.mode !== 'initialize') {
    throw new Error('initialize_required: a new Team must establish a baseline')
  }
  if (
    existingGroup &&
    input.mode === 'append' &&
    members.length === 0 &&
    !teamPolicy?.baselineInstantiationId
  ) {
    throw new Error('initialize_required: empty uninitialized Team must establish a baseline')
  }
  if (input.mode === 'initialize') {
    if (members.length > 0) throw new Error('team_not_empty: initialize requires an empty Team')
    if (teamPolicy?.baselineInstantiationId) {
      throw new Error('baseline_replacement_required: empty Team retains a baseline')
    }
  }
  const slotEndpoint = (slotId: string | null) => (slotId ? `new:${slotId}` : null)
  const newEdges = snapshot.edges.map((edge) => ({
    sourceKind: edge.sourceKind === 'slot' ? ('agent' as const) : edge.sourceKind,
    sourceId: edge.sourceKind === 'slot' ? slotEndpoint(edge.sourceId) : null,
    targetKind: edge.targetKind === 'slot' ? ('agent' as const) : edge.targetKind,
    targetId: edge.targetKind === 'slot' ? slotEndpoint(edge.targetId) : null,
    posture: edge.posture,
  }))
  return {
    mode: input.mode,
    teamId: input.teamId,
    currentRevision: teamPolicy?.revision ?? null,
    resultingRevision: teamPolicy ? teamPolicy.revision + 1 : 1,
    newMembers: snapshot.slots.map((slot) => ({
      slotId: slot.slotId,
      agentName: slot.agentName,
      profileId: slot.profileId,
    })),
    edges: [...(existingGroup ? teamPolicyRepo.edges(db, input.teamId) : []), ...newEdges],
  }
}

export class SpawnTeamTemplateError extends Error {
  override name = 'SpawnTeamTemplateError'
  readonly orphanAgentIds: string[]
  override readonly cause: unknown
  constructor(message: string, orphanAgentIds: string[], cause: unknown) {
    super(message)
    this.orphanAgentIds = orphanAgentIds
    this.cause = cause
  }
}

export async function spawnTeamTemplate(
  db: BazilionDb,
  paths: Paths,
  input: SpawnTeamTemplateInput,
): Promise<SpawnTeamTemplateResult> {
  const source = teamTemplateRepo.get(db, input.templateId)
  if (!source) throw new Error(`team template not found: ${input.templateId}`)
  if (source.deletedAt !== null) throw new Error(`template_deleted: ${input.templateId}`)
  if (source.currentRevision !== input.templateExpectedRevision) {
    throw new Error(
      `template_revision_conflict: expected ${input.templateExpectedRevision}, current ${source.currentRevision}`,
    )
  }
  const snapshot = teamTemplateRepo.revision(db, source.id, input.templateExpectedRevision)
  if (!snapshot)
    throw new Error(`template_snapshot_missing: ${source.id}@${source.currentRevision}`)
  for (const slot of snapshot.slots) {
    if (!profileRepo.get(db, slot.profileId)) {
      throw new Error(`profile not found: ${slot.profileId}`)
    }
  }
  const existingGroup = teamRepo.get(db, input.teamId, paths)
  if (existingGroup && !input.teamExpectedRevision) {
    throw new Error('team_revision_required: teamExpectedRevision is required')
  }
  const beforeAgentDirs = new Set(safeReaddir(paths.agentsDir))
  const beforeGroupDirs = new Set(safeReaddir(paths.teamsDir))
  const created: Agent[] = []
  try {
    inTx(db, () => {
      const transactionalSource = teamTemplateRepo.get(db, input.templateId)
      if (!transactionalSource || transactionalSource.deletedAt !== null) {
        throw new Error(`template_deleted: ${input.templateId}`)
      }
      if (transactionalSource.currentRevision !== input.templateExpectedRevision) {
        throw new Error(
          `template_revision_conflict: expected ${input.templateExpectedRevision}, current ${transactionalSource.currentRevision}`,
        )
      }
      const teamCreated = !existingGroup
      if (teamCreated) registerTeam(db, { id: input.teamId, name: input.teamId }, paths)
      const teamPolicy = teamPolicyRepo.get(db, input.teamId)
      if (!teamPolicy) throw new Error(`team_policy_missing: ${input.teamId}`)
      if (!teamCreated && teamPolicy.revision !== input.teamExpectedRevision) {
        throw new Error(
          `team_revision_conflict: expected ${input.teamExpectedRevision}, current ${teamPolicy.revision}`,
        )
      }
      const memberCount = agentRepo
        .list(db, { includeArchived: true })
        .filter((agent) => agent.teamId === input.teamId).length
      if (teamCreated && input.mode !== 'initialize') {
        throw new Error('initialize_required: a new Team must establish a baseline')
      }
      if (
        !teamCreated &&
        input.mode === 'append' &&
        memberCount === 0 &&
        teamPolicy.baselineInstantiationId === null
      ) {
        throw new Error('initialize_required: empty uninitialized Team must establish a baseline')
      }
      if (input.mode === 'initialize') {
        if (memberCount > 0) throw new Error('team_not_empty: initialize requires an empty Team')
        if (teamPolicy.baselineInstantiationId !== null) {
          throw new Error('baseline_replacement_required: empty Team retains a baseline')
        }
      }
      if (teamCreated && (input.userMd ?? snapshot.userMd)) {
        teamRepo.setUserMd(db, input.teamId, input.userMd ?? snapshot.userMd ?? '')
      }
      const existingNames = new Set(
        agentRepo
          .list(db, { includeArchived: true })
          .filter((agent) => agent.teamId === input.teamId)
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
            teamId: input.teamId,
            deferTeamPolicyUpdate: true,
          }),
        )
      }
      const instantiationId = randomUUID()
      db.raw.run(
        `INSERT INTO template_instantiations
           (id, team_id, template_id, template_revision, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [instantiationId, input.teamId, source.id, snapshot.revision, Date.now()],
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
        teamPolicyRepo.insertAgentState(db, input.teamId, agent.id)
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
          `INSERT INTO team_policy_edges
             (team_id, source_kind, source_id, target_kind, target_id, posture)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            input.teamId,
            edge.sourceKind === 'slot' ? 'agent' : edge.sourceKind,
            sourceId ?? '',
            edge.targetKind === 'slot' ? 'agent' : edge.targetKind,
            targetId ?? '',
            edge.posture,
          ],
        )
      }
      if (input.mode === 'initialize') {
        db.raw.run('UPDATE team_policies SET baseline_instantiation_id = ? WHERE team_id = ?', [
          instantiationId,
          input.teamId,
        ])
      }
      if (teamCreated) {
        db.raw.run('UPDATE team_policies SET updated_at = ? WHERE team_id = ?', [
          Date.now(),
          input.teamId,
        ])
      } else {
        teamPolicyRepo.bumpRevision(db, input.teamId)
      }
    })
    const team = teamPolicyRepo.detail(db, input.teamId)
    if (!team) throw new Error(`team_policy_missing: ${input.teamId}`)
    return { agents: created, team }
  } catch (error) {
    const orphans: string[] = []
    for (const dir of safeReaddir(paths.agentsDir).filter((name) => !beforeAgentDirs.has(name))) {
      if (!(await rmWithRetry(paths.agentDir(dir)))) orphans.push(dir)
    }
    for (const slug of safeReaddir(paths.teamsDir).filter((name) => !beforeGroupDirs.has(name))) {
      try {
        rmSync(paths.teamDir(slug), { recursive: true, force: true })
      } catch {}
    }
    throw new SpawnTeamTemplateError((error as Error).message, orphans, error)
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
