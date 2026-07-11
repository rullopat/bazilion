import type { Agent, LiveHarness, LiveHarnessEdge, TemplateInstantiation } from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { GroupTabs } from '../../../components/GroupTabs'
import { RecoveryState } from '../../../components/RecoveryState'
import { daemonClient } from '../../../lib/daemon-client'

const fetchPolicy = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<PolicyProjection> => {
    const detail = await daemonClient().get<PolicyProjection>(
      `/api/groups/${encodeURIComponent(data.id)}/harness`,
    )
    return detail
  })

interface PolicyProjection {
  harness: LiveHarness
  edges: LiveHarnessEdge[]
  baseline: TemplateInstantiation | null
  members: Agent[]
}

export const Route = createFileRoute('/groups/$id/policy')({
  loader: ({ params }) => fetchPolicy({ data: params }),
  component: GroupPolicyPage,
  errorComponent: ({ error, reset }) => <RecoveryState title="Group policy unavailable" error={error} reset={reset} fallbackHref="/groups" />,
})

function GroupPolicyPage() {
  const detail = Route.useLoaderData()
  const { id } = Route.useParams()
  const baseline = detail.baseline
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1>group policy</h1>
      <p className="muted">The sole effective live communication policy for <code>{id}</code>.</p>
      <GroupTabs groupId={id} />
      <section className="card" aria-labelledby="policy-status">
        <h2 id="policy-status" className="text-xl">Policy status</h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="muted">revision</dt><dd>{detail.harness.revision}</dd></div>
          <div><dt className="muted">membership mode</dt><dd>{detail.harness.membershipMode}</dd></div>
          <div><dt className="muted">allow edges</dt><dd>{detail.edges.length}</dd></div>
          <div><dt className="muted">baseline</dt><dd>{baseline ? `${baseline.templateId} r${baseline.templateRevision}` : 'not initialized'}</dd></div>
        </dl>
        <p className="mt-4 rounded-md border border-frost bg-ivory p-3 text-sm text-mocha">
          Policy editing arrives in BAZ-017. This server-backed projection is authoritative;
          local prototype policy is never shown as enforced.
        </p>
      </section>
    </div>
  )
}
