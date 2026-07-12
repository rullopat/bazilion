import type { Agent, SourceSlotBinding } from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { TeamTabs } from '../../../components/TeamTabs'
import { daemonClient } from '../../../lib/daemon-client'

const fetchMembers = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: string }) => data)
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
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1>team members</h1>
      <p className="muted"><code>agents.team_id</code> is the only live-membership authority.</p>
      <TeamTabs teamId={id} />
      <div className="overflow-x-auto rounded-md border border-frost">
        <table className="w-full">
          <thead><tr><th>agent</th><th>status</th><th>agent template</th><th>source slot</th></tr></thead>
          <tbody>
            {detail.members.map((agent) => {
              const binding = detail.bindings.find((item) => item.agentId === agent.id)
              return <tr key={agent.id}><td><a href={`/agents/${agent.id}`}>{agent.name}</a></td><td>{agent.status}</td><td>{agent.profileId}</td><td><code>{binding?.sourceSlotId ?? 'live-only'}</code></td></tr>
            })}
            {detail.members.length === 0 && <tr><td colSpan={4} className="muted">No agents belong to this team.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
