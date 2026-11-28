import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AGENT_ROLE_MAX,
  type Agent,
  agentNameProblem,
  DEFAULT_TEAM_ID,
  type ReasoningLevel,
} from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import { DomainError } from '../errors.ts'
import type { Paths } from '../paths.ts'
import { loadProfile } from '../profile/load.ts'
import * as agentRepo from '../repos/agents.ts'
import * as teamRepo from '../repos/teams.ts'
import { discoverSkills } from '../skills/discover.ts'

/** Put the role at the top of the Agent's SOUL.md and drop its first-run ritual. */
function giveRole(
  dir: string,
  role: string,
  teamName: string,
  addedBy: { id: string; name: string } | undefined,
): void {
  const day = new Date().toISOString().slice(0, 10)
  const who = addedBy
    ? `${addedBy.name} (Agent id ${addedBy.id}) added you to the Team ${teamName} on ${day}, when the operator asked. Report back to ${addedBy.name} unless the operator says otherwise.`
    : `The operator added you to the Team ${teamName} on ${day}.`
  const file = join(dir, 'SOUL.md')
  const rest = existsSync(file) ? readFileSync(file, 'utf8').trim() : ''
  writeFileSync(
    file,
    `${['# Your role', '', role, '', who].join('\n')}\n${rest ? `\n---\n\n${rest}\n` : ''}`,
  )
  rmSync(join(dir, 'BOOTSTRAP.md'), { force: true })
}

export interface SpawnAgentInput {
  profileId: string
  name?: string
  modelOverride?: string | null
  reasoningLevel?: ReasoningLevel
  /** What it is for; it then starts knowing its job, without the get-to-know questions. */
  role?: string
  /** Who added it, said under its role: "the operator" unless an Agent did. */
  addedBy?: { id: string; name: string }
  /**
   * Team the new agent joins. One agent belongs to exactly one team. When
   * omitted, falls back to the seeded 'default' team — the same fallback
   * used everywhere we need a sensible cwd. Must refer to an existing team.
   */
  teamId?: string
}

export function spawnAgent(db: BazilionDb, paths: Paths, input: SpawnAgentInput): Agent {
  // A blank name takes the template's, as the web and the CLI say.
  const givenName = input.name?.trim() || undefined
  const nameProblem = givenName === undefined ? null : agentNameProblem(givenName)
  if (nameProblem) throw new DomainError(400, nameProblem)
  const role = input.role?.trim() || undefined
  if (role && role.length > AGENT_ROLE_MAX) {
    throw new DomainError(400, `A role is at most ${AGENT_ROLE_MAX} characters.`)
  }
  const loaded = loadProfile(db, input.profileId)
  const id = randomUUID()
  const dir = paths.agentDir(id)
  try {
    return db.raw.transaction(() => {
      // Agent's private home: identity files + sessions. Memory is Team-level.
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

      const reasoningLevel: ReasoningLevel = input.reasoningLevel ?? 'medium'

      // Resolve team: explicit input wins; otherwise fall back to the seeded
      // 'default'. If neither exists, error out — an agent can't live without a
      // team (the FK `agents.team_id REFERENCES teams(id)` enforces it too).
      const teamId = input.teamId ?? DEFAULT_TEAM_ID
      const team = teamRepo.get(db, teamId, paths)
      if (!team) {
        throw new DomainError(
          400,
          `spawnAgent: team "${teamId}" does not exist. Pass an explicit --team or complete first-run setup first.`,
        )
      }
      if (givenName !== undefined && agentRepo.nameTakenInTeam(db, team.id, givenName)) {
        throw new DomainError(409, `${team.name} already has an Agent named ${givenName}.`)
      }
      const agent = agentRepo.insert(db, {
        id,
        profileId: input.profileId,
        // A name given is the Agent's own; the template's is numbered when the Team has it.
        name: givenName ?? agentRepo.freeNameInTeam(db, team.id, loaded.profile.name),
        modelOverride: input.modelOverride ?? null,
        reasoningLevel,
        status: 'idle',
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

      // Given a role, it starts knowing its job: the get-to-know questions are for Agents that
      // are told who they are in their first conversation.
      if (role) giveRole(dir, role, team.name, input.addedBy)

      return agent
    })()
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    throw error
  }
}
