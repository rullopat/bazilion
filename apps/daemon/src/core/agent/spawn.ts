import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Agent, HarnessPlacement, ReasoningLevel } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import type { Paths } from '../paths.ts'
import { loadProfile } from '../profile/load.ts'
import { DEFAULT_GROUP_ID } from '../profile/seed.ts'
import * as agentRepo from '../repos/agents.ts'
import * as groupRepo from '../repos/groups.ts'
import * as liveHarnessRepo from '../repos/liveHarnesses.ts'
import { discoverSkills } from '../skills/discover.ts'

export interface SpawnAgentInput {
  profileId: string
  name?: string
  modelOverride?: string | null
  reasoningLevel?: ReasoningLevel
  /**
   * Group the new agent joins. One agent belongs to exactly one group. When
   * omitted, falls back to the seeded 'default' group — the same fallback
   * used everywhere we need a sensible cwd. Must refer to an existing group.
   */
  groupId?: string
  /** Internal batch-spawn switch; the caller regenerates/bump the aggregate once. */
  deferHarnessUpdate?: boolean
  groupExpectedRevision?: number
  placement?: Exclude<HarnessPlacement, 'template_snapshot'>
}

export function spawnAgent(db: BazilionDb, paths: Paths, input: SpawnAgentInput): Agent {
  const loaded = loadProfile(db, input.profileId)
  const id = randomUUID()
  const dir = paths.agentDir(id)
  try {
    return db.raw.transaction(() => {
      // Agent's private home: identity files + sessions. Memory now lives at
      // the group level (`groups/<slug>/memory/`), shared by all member agents,
      // so we no longer create per-agent memory dirs here.
      mkdirSync(dir, { recursive: true })
      mkdirSync(join(dir, 'sessions'), { recursive: true })

      // Copy profile templates verbatim so the agent can diverge per-instance.
      // BOOTSTRAP.md is intentionally NOT personalized with the spawn slug —
      // the slug is a routing label, not necessarily the persona name. Bootstrap
      // is a pure conversation: the agent asks, the human answers, IDENTITY.md
      // is populated from that exchange.
      writeFileSync(join(dir, 'SOUL.md'), loaded.files.soul)
      writeFileSync(join(dir, 'IDENTITY.md'), loaded.files.identity)
      if (loaded.files.bootstrap !== null) {
        writeFileSync(join(dir, 'BOOTSTRAP.md'), loaded.files.bootstrap)
      }
      if (loaded.files.agents !== null) {
        writeFileSync(join(dir, 'AGENTS.md'), loaded.files.agents)
      }
      if (loaded.files.tools !== null) {
        writeFileSync(join(dir, 'TOOLS.md'), loaded.files.tools)
      }
      if (loaded.files.heartbeat !== null) {
        writeFileSync(join(dir, 'HEARTBEAT.md'), loaded.files.heartbeat)
      }

      const reasoningLevel: ReasoningLevel = input.reasoningLevel ?? 'medium'

      // Resolve group: explicit input wins; otherwise fall back to the seeded
      // 'default'. If neither exists, error out — an agent can't live without a
      // group (the FK `agents.group_id REFERENCES groups(id)` enforces it too).
      const groupId = input.groupId ?? DEFAULT_GROUP_ID
      const group = groupRepo.get(db, groupId, paths)
      if (!group) {
        throw new Error(
          `spawnAgent: group "${groupId}" does not exist. Pass an explicit --group or complete first-run setup first.`,
        )
      }
      const canonical = input.groupExpectedRevision !== undefined || input.placement !== undefined
      if (canonical && (!input.groupExpectedRevision || !input.placement)) {
        throw new Error('placement_required: groupExpectedRevision and placement are required')
      }
      if (!input.deferHarnessUpdate && !canonical) {
        liveHarnessRepo.requireCompatibilityOpen(db, group.id)
      }
      if (canonical) {
        const harness = liveHarnessRepo.get(db, group.id)
        if (!harness) throw new Error(`group_policy_missing: ${group.id}`)
        if (harness.revision !== input.groupExpectedRevision) {
          throw new Error(
            `group_revision_conflict: expected ${input.groupExpectedRevision}, current ${harness.revision}`,
          )
        }
      }

      const agentJson = {
        profileId: input.profileId,
        name: input.name ?? loaded.profile.name,
        modelOverride: input.modelOverride ?? null,
        reasoningLevel,
        groupId: group.id,
      }
      writeFileSync(join(dir, 'agent.json'), `${JSON.stringify(agentJson, null, 2)}\n`)

      const agent = agentRepo.insert(db, {
        id,
        profileId: input.profileId,
        name: agentJson.name,
        modelOverride: agentJson.modelOverride,
        reasoningLevel,
        status: 'idle',
        dir,
        groupId: group.id,
      })

      // Skills come from the profile only — `skills_mode='all'` attaches every
      // installed skill, `'selected'` attaches the profile's default list.
      // Per-agent skill changes happen post-spawn via `agent skill add/rm`.
      const skills =
        loaded.profile.skillsMode === 'all'
          ? discoverSkills(paths).map((s) => s.name)
          : loaded.defaultSkills
      for (const s of skills) agentRepo.attachSkill(db, id, s)

      if (!input.deferHarnessUpdate && canonical) {
        liveHarnessRepo.insertAgentState(db, group.id, agent.id)
        liveHarnessRepo.addPlacementEdges(
          db,
          group.id,
          agent.id,
          input.placement as Exclude<HarnessPlacement, 'template_snapshot'>,
          input.profileId,
        )
        liveHarnessRepo.bumpExplicit(db, group.id)
      } else if (!input.deferHarnessUpdate) {
        liveHarnessRepo.regenerateExactOpen(db, group.id)
      }

      return agent
    })()
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    throw error
  }
}
