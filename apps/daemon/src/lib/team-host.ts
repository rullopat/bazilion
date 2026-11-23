// An Agent's view of its Team: whom it can message (for its system prompt), and adding a teammate
// with `agent_create`. A teammate is added only in a turn the operator started, to the Agent's own
// Team, at most a few per turn; it starts knowing its role and who made it, without the first-run
// ritual, and in a restricted Team it is connected with its creator both ways.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { agentNameProblem } from '@bazilion/api-types'
import {
  agentRepo,
  type BazilionDb,
  mayMessage,
  type Paths,
  profileRepo,
  spawnAgent,
  teamPolicyRepo,
} from '../core/index.ts'
import { parseModelString } from '../core/providers.ts'
import type { AgentContact, CreateAgentArgs, CreatedAgent } from '../runtime/worker/ipc-protocol.ts'
import { signalLiveChange } from './live-signal.ts'
import { notifyDirectoryDirty } from './telegram/directory.ts'

/** Agents one turn may add: enough for a Team, not a runaway loop. */
export const MAX_CREATED_PER_TURN = 6
const MAX_ROLE = 4_000

/**
 * The other Agents that are not archived: every teammate, and Agents of other Teams that Team
 * Policy lets `agentId` message. Teammates first, in the order they joined.
 */
export function agentContacts(db: BazilionDb, agentId: string): AgentContact[] {
  const self = agentRepo.get(db, agentId)
  if (!self) return []
  const teams = new Map(
    db.raw
      .query<{ id: string; name: string }, []>('SELECT id, name FROM teams')
      .all()
      .map((team) => [team.id, team.name]),
  )
  const templates = new Map(profileRepo.list(db).map((profile) => [profile.id, profile.name]))
  const contacts = agentRepo
    .list(db)
    .filter((agent) => agent.id !== self.id)
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      teamId: agent.teamId,
      teamName: teams.get(agent.teamId) ?? agent.teamId,
      template: templates.get(agent.profileId) ?? agent.profileId,
      canMessage: mayMessage(db, self.id, agent.id).allowed,
    }))
  const own = contacts.filter((contact) => contact.teamId === self.teamId)
  const others = contacts
    .filter((contact) => contact.teamId !== self.teamId && contact.canMessage)
    .sort((a, b) => a.teamName.localeCompare(b.teamName))
  return [...own, ...others]
}

function roleNote(role: string, creator: { id: string; name: string }, teamName: string): string {
  return [
    '# Your role',
    '',
    role,
    '',
    `${creator.name} (Agent id ${creator.id}) added you to the Team ${teamName} on ${new Date().toISOString().slice(0, 10)}, when the operator asked. Report back to ${creator.name} unless the operator says otherwise.`,
  ].join('\n')
}

/** `agent_create` for one turn of `creatorId`. */
export function createDbTeamHost(
  db: BazilionDb,
  paths: Paths,
  creatorId: string,
): { createAgent(input: CreateAgentArgs): CreatedAgent } {
  let created = 0
  return {
    createAgent(input: CreateAgentArgs): CreatedAgent {
      const creator = agentRepo.get(db, creatorId)
      if (!creator) throw new Error('agent_create: your own Agent record is gone')
      const name = String(input.name ?? '').trim()
      const role = String(input.role ?? '').trim()
      if (!name) throw new Error('agent_create: "name" is required')
      const nameProblem = agentNameProblem(name)
      if (nameProblem) throw new Error(`agent_create: ${nameProblem}`)
      if (!role) throw new Error('agent_create: "role" is required: say what the Agent is for')
      if (role.length > MAX_ROLE) {
        throw new Error(`agent_create: a role is at most ${MAX_ROLE} characters`)
      }
      if (created >= MAX_CREATED_PER_TURN) {
        throw new Error(
          `agent_create: at most ${MAX_CREATED_PER_TURN} Agents per turn; ask the operator before adding more`,
        )
      }
      const taken = agentRepo
        .list(db)
        .some(
          (agent) =>
            agent.teamId === creator.teamId && agent.name.toLowerCase() === name.toLowerCase(),
        )
      if (taken) {
        throw new Error(`agent_create: this Team already has an Agent named "${name}"`)
      }

      const templateId = input.template?.trim() || creator.profileId
      const template = profileRepo.get(db, templateId)
      if (!template) {
        const known = profileRepo
          .list(db)
          .map((profile) => `${profile.id} (${profile.name})`)
          .join(', ')
        throw new Error(`agent_create: no Agent template "${templateId}". Templates: ${known}`)
      }
      const creatorTemplate = profileRepo.get(db, creator.profileId)
      const model =
        input.model?.trim() || creator.modelOverride || creatorTemplate?.defaultModel || ''
      if (model) parseModelString(model)

      const agent = spawnAgent(db, paths, {
        profileId: template.id,
        name,
        ...(model && model !== template.defaultModel ? { modelOverride: model } : {}),
        teamId: creator.teamId,
      })
      created++

      // It starts knowing its job and who to report to; the first-run ritual is for the Agents
      // the operator makes, who tell them who they are.
      const agentsFile = join(agent.dir, 'AGENTS.md')
      const teamName =
        db.raw
          .query<{ name: string }, [string]>('SELECT name FROM teams WHERE id = ?')
          .get(creator.teamId)?.name ?? creator.teamId
      const rest = existsSync(agentsFile) ? readFileSync(agentsFile, 'utf8').trim() : ''
      writeFileSync(
        agentsFile,
        `${roleNote(role, creator, teamName)}\n${rest ? `\n---\n\n${rest}\n` : ''}`,
      )
      rmSync(join(agent.dir, 'BOOTSTRAP.md'), { force: true })

      const restricted = teamPolicyRepo.mode(db, creator.teamId) === 'restricted'
      if (restricted) {
        teamPolicyRepo.insertEdges(db, creator.teamId, [
          { from: creator.id, to: agent.id },
          { from: agent.id, to: creator.id },
        ])
      }
      notifyDirectoryDirty()
      signalLiveChange()
      return {
        id: agent.id,
        name: agent.name,
        teamId: creator.teamId,
        teamName,
        template: template.name,
        model: model || template.defaultModel,
        connected: restricted,
      }
    },
  }
}
