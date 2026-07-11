import type { HarnessTemplateWithCount, LiveAgentState, Profile, ResolvedGroupHarness } from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { ProductionHarnessEditor } from '../../../components/harness/ProductionHarnessEditor'
import { GroupPolicyOperations } from '../../../components/harness/GroupPolicyOperations'
import { GroupTabs } from '../../../components/GroupTabs'
import { RecoveryState } from '../../../components/RecoveryState'
import { daemonClient } from '../../../lib/daemon-client'

interface PolicyLoader {
  detail: Omit<ResolvedGroupHarness, 'agentState'> & {
    agentState: Array<Omit<LiveAgentState, 'display'> & { display: null }>
  }
  profiles: Profile[]
  templates: HarnessTemplateWithCount[]
}
type PolicyLoaderResult = { ok: true; value: PolicyLoader } | { ok: false; error: string }

const fetchPolicy = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<PolicyLoaderResult> => {
    try {
      const client = daemonClient()
      const [detail, profiles, templates] = await Promise.all([
        client.get<ResolvedGroupHarness>(`/api/groups/${encodeURIComponent(data.id)}/harness`),
        client.get<Profile[]>('/api/profiles'),
        client.get<HarnessTemplateWithCount[]>('/api/harness-templates'),
      ])
      return {
        ok: true,
        value: {
          detail: {
            ...detail,
            agentState: detail.agentState.map((state) => ({ ...state, display: null })),
          },
          profiles,
          templates,
        },
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

export const Route = createFileRoute('/groups/$id/policy')({
  validateSearch: (search: Record<string, unknown>) => ({
    view: search.view === 'matrix' ? 'matrix' as const : 'flow' as const,
    selected: typeof search.selected === 'string' ? search.selected : null,
    vx: Number.isFinite(Number(search.vx)) ? Number(search.vx) : 0,
    vy: Number.isFinite(Number(search.vy)) ? Number(search.vy) : 0,
    vz: Number.isFinite(Number(search.vz)) ? Number(search.vz) : 0.9,
  }),
  loader: ({ params }) => fetchPolicy({ data: params }),
  component: GroupPolicyPage,
  errorComponent: ({ error, reset }) => <RecoveryState title="Group policy unavailable" error={error} reset={reset} fallbackHref="/groups" />,
})

function GroupPolicyPage() {
  const result = Route.useLoaderData()
  if (!result.ok) {
    return <RecoveryState title="Group policy unavailable" error={new Error(result.error)} reset={() => window.location.reload()} fallbackHref="/groups" />
  }
  const { detail, profiles, templates } = result.value
  const { id } = Route.useParams()
  const search = Route.useSearch()
  const baseline = detail.baseline
  return <div className="mx-auto max-w-[1500px] space-y-5 px-4 py-6 sm:px-6">
    <div><h1>group policy</h1><p className="muted">The sole effective live communication policy for <code>{id}</code>.</p></div>
    <GroupTabs groupId={id} />
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Policy status">
      <Status label="Revision" value={detail.harness.revision} />
      <Status label="Membership mode" value={detail.harness.membershipMode} />
      <Status label="Allow edges" value={detail.edges.length} />
      <Status label="Baseline" value={baseline ? `${baseline.templateId} r${baseline.templateRevision}` : 'Not initialized'} />
    </section>
    <ProductionHarnessEditor source={{ kind: 'live', groupId: id, detail }} profiles={profiles} initialUi={{view:search.view,selectedId:search.selected,viewport:{x:search.vx,y:search.vy,zoom:search.vz}}} />
    <GroupPolicyOperations groupId={id} detail={detail} templates={templates} />
  </div>
}

function Status({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="card"><dt className="muted text-xs">{label}</dt><dd className="break-words font-semibold">{value}</dd></div>
}
