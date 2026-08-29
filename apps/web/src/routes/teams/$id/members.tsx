import type { Agent, SourceSlotBinding } from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { EmptyState, PageShell, SectionCard, StatusBadge } from '../../../components/Page'
import { TeamTabs } from '../../../components/TeamTabs'
import { daemonClient } from '../../../lib/daemon-client'

const fetchMembers = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) => data)
  .handler(({ data }) =>
    daemonClient().get<MembersProjection>(`/api/teams/${encodeURIComponent(data.id)}/policy`),
  )

interface MembersProjection {
  members: Agent[]
  bindings: SourceSlotBinding[]
}

export const Route = createFileRoute('/teams/$id/members')({
  loader: ({ params }) => fetchMembers({ data: params }),
  component: TeamMembersPage,
})

function TeamMembersPage() {
  const detail = Route.useLoaderData()
  const { id } = Route.useParams()
  return (
    <PageShell>
      <h1>Team members</h1>
      <p className="muted"><code>agents.team_id</code> is the only live-membership authority.</p>
      <TeamTabs teamId={id} />
      {detail.members.length === 0 ? (
        <EmptyState
          title="No Team members"
          description="Spawn an Agent into this Team from the Agents page or apply a Team template."
          actions={<a href="/agents" className="btn-primary no-underline">Spawn an Agent</a>}
        />
      ) : (
      <SectionCard
        title="Live roster"
        description="Every Agent belongs to exactly one Team; source slots show reusable-template lineage only."
      >
      <div className="hidden overflow-x-auto rounded-md border border-frost md:block">
        <table className="w-full">
          <thead><tr><th>agent</th><th>status</th><th>agent template</th><th>source slot</th></tr></thead>
          <tbody>
            {detail.members.map((agent) => {
              const binding = detail.bindings.find((item) => item.agentId === agent.id)
              return <tr key={agent.id}><td><a href={`/agents/${agent.id}`}>{agent.name}</a></td><td>{agent.status}</td><td>{agent.profileId}</td><td><code>{binding?.sourceSlotId ?? 'live-only'}</code></td></tr>
            })}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 md:hidden">
        {detail.members.map((agent) => {
          const binding = detail.bindings.find((item) => item.agentId === agent.id)
          return (
            <article key={agent.id} className="min-w-0 rounded-xl border border-border bg-muted/20 p-4">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <a href={`/agents/${agent.id}`} className="block truncate font-semibold text-foreground">
                    {agent.name}
                  </a>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                    {agent.id}
                  </p>
                </div>
                <StatusBadge variant={agent.status === 'archived' ? 'warning' : 'success'}>
                  {agent.status}
                </StatusBadge>
              </div>
              <dl className="mt-3 grid gap-2 text-xs">
                <div className="rounded-lg bg-muted p-2">
                  <dt className="font-semibold text-muted-foreground">Agent template</dt>
                  <dd className="mt-0.5 break-all font-mono">{agent.profileId}</dd>
                </div>
                <div className="rounded-lg bg-muted p-2">
                  <dt className="font-semibold text-muted-foreground">Source slot</dt>
                  <dd className="mt-0.5 break-all font-mono">{binding?.sourceSlotId ?? 'live-only'}</dd>
                </div>
              </dl>
            </article>
          )
        })}
      </div>
      </SectionCard>
      )}
    </PageShell>
  )
}
