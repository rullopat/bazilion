import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Agent, ReasoningLevel, TeamPolicyPlacement } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import type { Paths } from '../paths.ts'
import { loadProfile } from '../profile/load.ts'
import { DEFAULT_TEAM_ID } from '../profile/seed.ts'
import * as agentRepo from '../repos/agents.ts'
import * as teamPolicyRepo from '../repos/teamPolicies.ts'
import * as teamRepo from '../repos/teams.ts'
import { discoverSkills } from '../skills/discover.ts'

export interface SpawnAgentInput {
  profileId: string
  name?: string
  modelOverride?: string | null
  reasoningLevel?: ReasoningLevel
  /**
   * Team the new agent joins. One agent belongs to exactly one team. When
   * omitted, falls back to the seeded 'default' team — the same fallback
   * used everywhere we need a sensible cwd. Must refer to an existing team.
   */
  teamId?: string
  /** Internal batch-spawn switch; the caller regenerates/bump the aggregate once. */
  deferTeamPolicyUpdate?: boolean
  teamExpectedRevision?: number
  placement?: Exclude<TeamPolicyPlacement, 'template_snapshot'>
}

export function spawnAgent(db: BazilionDb, paths: Paths, input: SpawnAgentInput): Agent {
  const loaded = loadProfile(db, input.profileId)
  const id = randomUUID()
  const dir = paths.agentDir(id)
  try {
    return db.raw.transaction(() => {
      // Agent's private home: identity files + sessions. Memory now lives at
      // the team level (`teams/<slug>/memory/`), shared by all member agents,
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

      // Resolve team: explicit input wins; otherwise fall back to the seeded
      // 'default'. If neither exists, error out — an agent can't live without a
      // team (the FK `agents.team_id REFERENCES teams(id)` enforces it too).
      const teamId = input.teamId ?? DEFAULT_TEAM_ID
      const team = teamRepo.get(db, teamId, paths)
      if (!team) {
        throw new Error(
          `spawnAgent: team "${teamId}" does not exist. Pass an explicit --team or complete first-run setup first.`,
        )
      }
      let placement = input.placement
      if (!input.deferTeamPolicyUpdate) {
        const teamPolicy = teamPolicyRepo.get(db, team.id)
        if (!teamPolicy) throw new Error(`team_policy_missing: ${team.id}`)
        const expectedRevision = input.teamExpectedRevision ?? teamPolicy.revision
        placement ??= 'open'
        if (teamPolicy.revision !== expectedRevision) {
          throw new Error(
            `team_revision_conflict: expected ${expectedRevision}, current ${teamPolicy.revision}`,
          )
        }
      }

      const agentJson = {
        profileId: input.profileId,
        name: input.name ?? loaded.profile.name,
        modelOverride: input.modelOverride ?? null,
        reasoningLevel,
        teamId: team.id,
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
        teamId: team.id,
      })

      // Skills come from the profile only — `skills_mode='all'` attaches every
      // installed skill, `'selected'` attaches the profile's default list.
      // Per-agent skill changes happen post-spawn via `agent skill add/rm`.
      const skills =
        loaded.profile.skillsMode === 'all'
          ? discoverSkills(paths).map((s) => s.name)
          : loaded.defaultSkills
      for (const s of skills) agentRepo.attachSkill(db, id, s)

      if (!input.deferTeamPolicyUpdate) {
        teamPolicyRepo.insertAgentState(db, team.id, agent.id)
        teamPolicyRepo.addPlacementEdges(
          db,
          team.id,
          agent.id,
          placement as Exclude<TeamPolicyPlacement, 'template_snapshot'>,
          input.profileId,
        )
        teamPolicyRepo.bumpRevision(db, team.id)
      }

      return agent
    })()
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    throw error
  }
}
