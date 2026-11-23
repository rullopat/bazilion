import type { Agent, ModelsResponse, ProfileSummary, Team } from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { Button } from '../../components/Button'
import { ManagePage } from '../../components/ManagePage'
import { MODELS_PATH } from '../../components/ModelMenu'
import { AgentsCard } from '../../components/manage/AgentsCard'
import { SpawnDialog } from '../../components/SpawnDialog'
import { daemonClient } from '../../lib/daemon-client'

const fetchAgents = createServerFn({ method: 'GET' }).handler(async () => {
  const client = daemonClient()
  const [agents, templates, teams, models] = await Promise.all([
    client.get<Agent[]>('/api/agents?includeArchived=true'),
    client.get<ProfileSummary[]>('/api/profiles'),
    client.get<Team[]>('/api/teams'),
    client.get<ModelsResponse>(MODELS_PATH),
  ])
  return { agents, templates, teams, chat: models.chat }
})

export const Route = createFileRoute('/agents/')({
  loader: () => fetchAgents(),
  component: AgentsPage,
})

function AgentsPage() {
  const { agents, templates, teams, chat } = Route.useLoaderData()
  const router = useRouter()
  const [spawning, setSpawning] = useState(false)

  return (
    <ManagePage
      title="Agents"
      description="Every Agent in every Team. Open one to talk to it; its model, skills and schedules are in its side panel."
      actions={
        <Button
          variant="primary"
          disabled={templates.length === 0 || teams.length === 0}
          onClick={() => setSpawning(true)}
        >
          Add an Agent
        </Button>
      }
    >
      <AgentsCard
        agents={agents}
        teams={teams}
        templates={templates}
        chat={chat}
        onSpawn={() => setSpawning(true)}
        onChanged={() => router.invalidate({ sync: true })}
      />
      {spawning && (
        <SpawnDialog profiles={templates} teams={teams} onClose={() => setSpawning(false)} />
      )}
    </ManagePage>
  )
}
