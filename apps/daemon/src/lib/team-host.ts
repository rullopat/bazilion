// An Agent's view of its Team: whom it can message (for its system prompt), and adding a teammate
// with `agent_create`. A teammate is added only in a turn the operator started, to the Agent's own
// Team, at most a few per turn; it starts knowing its role and who made it, without the first-run
// ritual, and in a restricted Team it is connected with its creator both ways.

import { join } from 'node:path'
import { AGENT_ROLE_MAX, agentNameProblem, chosenName } from '@bazilion/api-types'
import {
  agentRepo,
  type BazilionDb,
  loadIdentityFromFile,
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

/** The name an Agent gave itself in its IDENTITY.md, when it is not its name in the list. */
function calledName(agent: { name: string; dir: string }): { calledName?: string } {
  const own = chosenName({
    ...agent,
    identity: loadIdentityFromFile(join(agent.dir, 'IDENTITY.md')),
  })
  return own ? { calledName: own } : {}
}

/** Agents one turn may add: enough for a Team, not a runaway loop. */
export const MAX_CREATED_PER_TURN = 6

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
      // Only a teammate is reached by the name it gave itself (`recipientOf`).
      ...(agent.teamId === self.teamId ? calledName(agent) : {}),
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
      if (role.length > AGENT_ROLE_MAX) {
        throw new Error(`agent_create: a role is at most ${AGENT_ROLE_MAX} characters`)
      }
      if (created >= MAX_CREATED_PER_TURN) {
        throw new Error(
          `agent_create: at most ${MAX_CREATED_PER_TURN} Agents per turn; ask the operator before adding more`,
        )
      }
      if (agentRepo.nameTakenInTeam(db, creator.teamId, name)) {
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
        // It starts knowing its job and who to report to.
        role,
        addedBy: { id: creator.id, name: creator.name },
      })
      created++
      const teamName =
        db.raw
          .query<{ name: string }, [string]>('SELECT name FROM teams WHERE id = ?')
          .get(creator.teamId)?.name ?? creator.teamId

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
