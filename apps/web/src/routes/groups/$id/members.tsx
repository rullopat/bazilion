import type { Agent, SourceSlotBinding } from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { GroupTabs } from '../../../components/GroupTabs'
import { daemonClient } from '../../../lib/daemon-client'

const fetchMembers = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: string }) => data)
  .handler(({ data }) =>
    daemonClient().get<MembersProjection>(`/api/groups/${encodeURIComponent(data.id)}/harness`),
  )

interface MembersProjection {
  members: Agent[]
  bindings: SourceSlotBinding[]
}

export const Route = createFileRoute('/groups/$id/members')({
  loader: ({ params }) => fetchMembers({ data: params }),
  component: GroupMembersPage,
})

function GroupMembersPage() {
  const detail = Route.useLoaderData()
  const { id } = Route.useParams()
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1>group members</h1>
      <p className="muted"><code>agents.group_id</code> is the only live-membership authority.</p>
      <GroupTabs groupId={id} />
      <div className="overflow-x-auto rounded-md border border-frost">
        <table className="w-full">
          <thead><tr><th>agent</th><th>status</th><th>agent template</th><th>source slot</th></tr></thead>
          <tbody>
            {detail.members.map((agent) => {
              const binding = detail.bindings.find((item) => item.agentId === agent.id)
              return <tr key={agent.id}><td><a href={`/agents/${agent.id}`}>{agent.name}</a></td><td>{agent.status}</td><td>{agent.profileId}</td><td><code>{binding?.sourceSlotId ?? 'live-only'}</code></td></tr>
            })}
            {detail.members.length === 0 && <tr><td colSpan={4} className="muted">No agents belong to this group.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
