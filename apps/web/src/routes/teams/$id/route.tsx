// The Team page frame: name, workspace path and section tabs around the Team's views.

import type { Team } from '@bazilion/api-types'
import { ApiClientError } from '@bazilion/client'
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { PageShell } from '../../../components/Page'
import { SectionTabs, TEAM_TABS } from '../../../components/SectionTabs'
import { daemonClient } from '../../../lib/daemon-client'

const fetchTeam = createServerFn({ method: 'GET' })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<Team | null> => {
    try {
      return await daemonClient().get<Team>(`/api/teams/${encodeURIComponent(data.id)}`)
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 404) return null
      throw error
    }
  })

export const Route = createFileRoute('/teams/$id')({
  loader: async ({ params }) => {
    const team = await fetchTeam({ data: { id: params.id } })
    if (!team) throw redirect({ to: '/teams' })
    return team
  },
  component: TeamLayout,
})

function TeamLayout() {
  const team = Route.useLoaderData()
  return (
    <PageShell size="wide">
      <header>
        <h1 className="font-serif text-3xl text-foreground">
          {team.name} <span className="text-base text-muted-foreground">({team.id})</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <code className="font-mono">{team.path}</code> · {team.policyMode} policy
        </p>
      </header>
      <SectionTabs
        label="Team sections"
        base={`/teams/${encodeURIComponent(team.id)}`}
        tabs={TEAM_TABS}
      />
      <Outlet />
    </PageShell>
  )
}
