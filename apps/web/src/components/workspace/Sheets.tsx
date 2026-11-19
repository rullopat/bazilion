// The deeper pages of the open Agent and of the Team in view, each a sheet over the workspace.
// `section` in the address names the one that is open.

import type { SkillInfo } from '@bazilion/api-types'
import { useRouter } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { api } from '../../lib/api'
import { useResource } from '../../lib/use-resource'
import { isAgentSection, isTeamSection } from '../../lib/workspace'
import { AgentBrowserCard } from '../AgentBrowserCard'
import { AgentSkills } from '../AgentSkills'
import { AgentTelegram } from '../AgentTelegram'
import { AgentLearning } from '../agent/AgentLearning'
import { AgentMailbox } from '../agent/AgentMailbox'
import { AgentSchedules } from '../agent/AgentSchedules'
import { TeamMemory } from '../team/TeamMemory'
import { TeamSettings } from '../team/TeamSettings'
import { TeamUserMd } from '../team/TeamUserMd'
import { useWorkspace } from './context'
import { Sheet } from './Sheet'

export function Sheets() {
  const { agent, team, agents, search, to } = useWorkspace()
  const router = useRouter()
  const section = search.section
  if (!section) return null
  const close = () =>
    void router.navigate({ to: '/', search: to({ section: undefined, note: undefined }) })
  let title: string
  let description: ReactNode
  let body: ReactNode

  if (isAgentSection(section)) {
    if (!agent) return null
    const { name, id } = agent.agent
    switch (section) {
      case 'schedules':
        title = `${name}'s schedules`
        description =
          'A schedule sends this Agent a message on an interval or a cron expression, as if you had written it.'
        body = <AgentSchedules key={id} agent={agent.agent} />
        break
      case 'learning':
        title = `What ${name} has learned`
        description =
          'A review reads recent turns and proposes lessons. Nothing changes until you approve a lesson.'
        body = <AgentLearning key={id} agent={agent.agent} />
        break
      case 'mailbox':
        title = `${name}'s mailbox`
        description =
          'Messages other Agents sent it. An idle Agent picks up unread mail on the next scheduler tick.'
        body = <AgentMailbox key={id} agent={agent.agent} agents={agents} />
        break
      case 'skills':
        title = `${name}'s skills`
        description = 'Attach or detach the installed prompt skills for this Agent.'
        body = <SkillsBody key={id} agentId={id} attached={agent.skills} />
        break
      case 'telegram':
        title = `${name} on Telegram`
        description = 'Bind this Agent to its forum topic and choose what is mirrored there.'
        body = <AgentTelegram key={id} agent={agent.agent} />
        break
      case 'browser':
        title = `${name}'s browser`
        description = 'The browser this Agent drives: its session and its saved profile.'
        body = <AgentBrowserCard key={id} agentId={id} />
        break
    }
  } else if (isTeamSection(section)) {
    if (!team) return null
    switch (section) {
      case 'user-md':
        title = `USER.md of ${team.name}`
        description =
          'What every member of this Team is told about you, on every turn. Only you can edit it; Agents cannot.'
        body = <TeamUserMd key={team.id} team={team} />
        break
      case 'memory':
        title = `Shared memory of ${team.name}`
        description = (
          <>
            Notes every Agent of this Team reads, writes and searches. Notes about one Agent belong
            in its own <code>IDENTITY.md</code>.
          </>
        )
        body = <TeamMemory key={team.id} team={team} openKey={search.note} />
        break
      case 'settings':
        title = `Settings of ${team.name}`
        body = (
          <TeamSettings
            key={team.id}
            team={team}
            sampleAgent={agents.find((entry) => entry.teamId === team.id)?.name ?? 'researcher'}
          />
        )
        break
    }
  } else {
    return null
  }

  return (
    <Sheet title={title} description={description} onClose={close}>
      {body}
    </Sheet>
  )
}

function SkillsBody({ agentId, attached }: { agentId: string; attached: string[] }) {
  const skills = useResource((signal) => api<SkillInfo[]>('/api/skills', { signal }), [])
  if (skills.error) {
    return (
      <p role="alert" className="err">
        {skills.error}
      </p>
    )
  }
  if (!skills.data) {
    return (
      <p role="status" className="muted">
        Loading the skills…
      </p>
    )
  }
  if (skills.data.length === 0) {
    return (
      <p className="muted">
        No skills are installed yet. Add some under <a href="/skills">Skills</a>.
      </p>
    )
  }
  return <AgentSkills agentId={agentId} attached={new Set(attached)} all={skills.data} />
}
