// The deeper pages of the open Agent and of the Team in view, each a sheet over the workspace.
// `section` in the address names the one that is open. Each page's cards say what they are for,
// so a sheet carries only its title.

import { useRouter } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { isAgentSection, isTeamSection } from '../../lib/workspace'
import { AgentBrowserCard } from '../AgentBrowserCard'
import { AgentSkillsSheet } from '../AgentSkills'
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
  let body: ReactNode

  if (isAgentSection(section)) {
    if (!agent) return null
    const { name, id } = agent.agent
    switch (section) {
      case 'schedules':
        title = `${name}’s schedules`
        body = <AgentSchedules key={id} agent={agent.agent} />
        break
      case 'learning':
        title = `What ${name} has learned`
        body = <AgentLearning key={id} agent={agent.agent} />
        break
      case 'mailbox':
        title = `${name}’s mailbox`
        body = <AgentMailbox key={id} agent={agent.agent} agents={agents} />
        break
      case 'skills':
        title = `${name}’s skills`
        body = <AgentSkillsSheet key={id} agentId={id} agentName={name} attached={agent.skills} />
        break
      case 'telegram':
        title = `${name} on Telegram`
        body = <AgentTelegram key={id} agent={agent.agent} />
        break
      case 'browser':
        title = `${name}’s browser`
        body = <AgentBrowserCard key={id} agentId={id} agentName={name} />
        break
    }
  } else if (isTeamSection(section)) {
    if (!team) return null
    switch (section) {
      case 'user-md':
        title = `${team.name}: about you`
        body = <TeamUserMd key={team.id} team={team} />
        break
      case 'memory':
        title = `${team.name}: shared memory`
        body = <TeamMemory key={team.id} team={team} openKey={search.note} />
        break
      case 'settings':
        title = `${team.name}: settings`
        body = (
          <TeamSettings
            key={team.id}
            team={team}
            sampleAgent={agents.find((entry) => entry.teamId === team.id)?.name ?? 'Researcher'}
          />
        )
        break
    }
  } else {
    return null
  }

  return (
    <Sheet title={title} onClose={close}>
      {body}
    </Sheet>
  )
}
