import type { TeamTemplateWithCount, TeamAgentState, Profile, ResolvedTeamPolicy } from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { PageShell } from '../../../components/Page'
import { ProductionTeamPolicyEditor } from '../../../components/team-policy/ProductionTeamPolicyEditor'
import { TeamPolicyOperations } from '../../../components/team-policy/TeamPolicyOperations'
import { TeamTabs } from '../../../components/TeamTabs'
import { RecoveryState } from '../../../components/RecoveryState'
import { daemonClient } from '../../../lib/daemon-client'

interface PolicyLoader {
  detail: Omit<ResolvedTeamPolicy, 'agentState'> & {
    agentState: Array<Omit<TeamAgentState, 'display'> & { display: null }>
  }
  profiles: Profile[]
  templates: TeamTemplateWithCount[]
}
type PolicyLoaderResult = { ok: true; value: PolicyLoader } | { ok: false; error: string }

const fetchPolicy = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<PolicyLoaderResult> => {
    try {
      const client = daemonClient()
      const [detail, profiles, templates] = await Promise.all([
        client.get<ResolvedTeamPolicy>(`/api/teams/${encodeURIComponent(data.id)}/policy`),
        client.get<Profile[]>('/api/profiles'),
        client.get<TeamTemplateWithCount[]>('/api/team-templates'),
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

export const Route = createFileRoute('/teams/$id/policy')({
  validateSearch: (search: Record<string, unknown>) => ({
    view: search.view === 'matrix' ? 'matrix' as const : 'flow' as const,
    selected: typeof search.selected === 'string' ? search.selected : null,
    vx: Number.isFinite(Number(search.vx)) ? Number(search.vx) : 0,
    vy: Number.isFinite(Number(search.vy)) ? Number(search.vy) : 0,
    vz: Number.isFinite(Number(search.vz)) ? Number(search.vz) : 0.9,
  }),
  loader: ({ params }) => fetchPolicy({ data: params }),
  component: TeamPolicyPage,
  errorComponent: ({ error, reset }) => <RecoveryState title="Team policy unavailable" error={error} reset={reset} fallbackHref="/teams" />,
})

function TeamPolicyPage() {
  const result = Route.useLoaderData()
  if (!result.ok) {
    return <RecoveryState title="Team policy unavailable" error={new Error(result.error)} reset={() => window.location.reload()} fallbackHref="/teams" />
  }
  const { detail, profiles, templates } = result.value
  const { id } = Route.useParams()
  const search = Route.useSearch()
  const baseline = detail.baseline
  return <PageShell size="wide">
    <div><h1>Team policy</h1><p className="muted">The sole effective live communication policy for <code>{id}</code>.</p></div>
    <TeamTabs teamId={id} />
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Policy status">
      <Status label="Revision" value={detail.teamPolicy.revision} />
      <Status label="Allow edges" value={detail.edges.length} />
      <Status label="Baseline" value={baseline ? `${baseline.templateId} r${baseline.templateRevision}` : 'Not initialized'} />
    </section>
    <ProductionTeamPolicyEditor source={{ kind: 'live', teamId: id, detail }} profiles={profiles} initialUi={{view:search.view,selectedId:search.selected,viewport:{x:search.vx,y:search.vy,zoom:search.vz}}} />
    <TeamPolicyOperations teamId={id} detail={detail} templates={templates} />
  </PageShell>
}

function Status({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="card"><dt className="muted text-xs">{label}</dt><dd className="break-words font-semibold">{value}</dd></div>
}
