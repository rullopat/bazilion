import type { Agent, Team } from '@bazilion/api-types'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import {
  EmptyState,
  ItemList,
  ItemRow,
  PageHeader,
  PageShell,
  SectionCard,
  StatusBadge,
} from '../../components/Page'
import { TeamForm } from '../../components/TeamForm'
import { api } from '../../lib/api'
import { daemonClient } from '../../lib/daemon-client'

const fetchTeams = createServerFn({ method: 'GET' }).handler(async () => {
  const client = daemonClient()
  const [teams, agents] = await Promise.all([
    client.get<Team[]>('/api/teams'),
    client.get<Agent[]>('/api/agents?includeArchived=true'),
  ])
  const memberCounts: Record<string, number> = {}
  for (const agent of agents) memberCounts[agent.teamId] = (memberCounts[agent.teamId] ?? 0) + 1
  return { teams, memberCounts }
})

export const Route = createFileRoute('/teams/')({
  loader: () => fetchTeams(),
  component: TeamsPage,
})

function TeamsPage() {
  const { teams, memberCounts } = Route.useLoaderData()
  const router = useRouter()
  const [removeTarget, setRemoveTarget] = useState<Team | null>(null)

  return (
    <PageShell size="wide">
      <PageHeader
        eyebrow="Workspace"
        title="Teams"
        description="Each Team owns one workspace, its members and who may message whom. Every Agent belongs to exactly one Team. Register a Team here, or remove an empty one."
      />

      <SectionCard title="Register a team">
        <TeamForm onCreated={() => router.invalidate()} />
      </SectionCard>

      <SectionCard
        title="Registered teams"
        description="Open a Team for its members, USER.md, shared memory and connections."
      >
        {teams.length === 0 ? (
          <EmptyState
            title="No teams registered"
            description="Register a Team above to create a workspace for your agents."
          />
        ) : (
          <ItemList>
            {teams.map((team) => {
              const count = memberCounts[team.id] ?? 0
              return (
                <ItemRow
                  key={team.id}
                  title={
                    <Link to="/" search={{ team: team.id, panel: 'team' }}>
                      {team.name}
                    </Link>
                  }
                  meta={
                    <>
                      <code>{team.id}</code>
                      <StatusBadge variant={count > 0 ? 'success' : 'neutral'}>
                        {count} member{count === 1 ? '' : 's'}
                      </StatusBadge>
                      <Link to="/" search={{ team: team.id, view: 'connections' }}>
                        {team.policyMode === 'open' ? 'Open' : 'Restricted'}: see connections
                      </Link>
                    </>
                  }
                  actions={
                    count === 0 && (
                      <Button variant="danger" onClick={() => setRemoveTarget(team)}>
                        Remove
                      </Button>
                    )
                  }
                />
              )
            })}
          </ItemList>
        )}
      </SectionCard>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null)
        }}
        title={`Remove ${removeTarget?.name ?? 'Team'}?`}
        description={
          <p>
            This removes the empty Team and its workspace slot under ~/.bazilion/teams/. When the
            slot links to a project directory, only the link is removed, never the directory.
          </p>
        }
        confirmLabel="Remove Team"
        onConfirm={async () => {
          if (!removeTarget) return
          await api(`/api/teams/${encodeURIComponent(removeTarget.id)}`, { method: 'DELETE' })
          await router.invalidate()
        }}
      />
    </PageShell>
  )
}
