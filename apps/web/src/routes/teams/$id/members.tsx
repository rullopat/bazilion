import type { TeamPolicy } from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { EmptyState, ItemList, ItemRow, SectionCard, StatusBadge } from '../../../components/Page'
import { daemonClient } from '../../../lib/daemon-client'

const fetchMembers = createServerFn({ method: 'GET' })
  .validator((data: { id: string }) => data)
  .handler(({ data }) =>
    daemonClient().get<TeamPolicy>(`/api/teams/${encodeURIComponent(data.id)}/policy`),
  )

export const Route = createFileRoute('/teams/$id/members')({
  loader: ({ params }) => fetchMembers({ data: { id: params.id } }),
  component: TeamMembersPage,
})

function TeamMembersPage() {
  const { members } = Route.useLoaderData()
  if (members.length === 0) {
    return (
      <EmptyState
        title="No Team members"
        description="Spawn an Agent into this Team from the Agents page, or spawn a Team template into it."
        actions={
          <a href="/agents" className="btn-primary no-underline">
            Spawn an Agent
          </a>
        }
      />
    )
  }
  return (
    <SectionCard title="Members" description="Every Agent belongs to exactly one Team.">
      <ItemList>
        {members.map((agent) => (
          <ItemRow
            key={agent.id}
            title={<a href={`/agents/${agent.id}`}>{agent.name}</a>}
            meta={
              <>
                <StatusBadge variant={agent.status === 'archived' ? 'warning' : 'success'}>
                  {agent.status}
                </StatusBadge>
                <span>
                  template <code>{agent.profileId}</code>
                </span>
                <code>{agent.id}</code>
              </>
            }
          />
        ))}
      </ItemList>
    </SectionCard>
  )
}
