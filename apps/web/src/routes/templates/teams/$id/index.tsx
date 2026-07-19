import type { TeamTemplateDetail, TeamTemplateRevision, TeamTemplateSlot, Profile } from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { PageShell } from '../../../../components/Page'
import { ProductionTeamPolicyEditor } from '../../../../components/team-policy/ProductionTeamPolicyEditor'
import { RecoveryState } from '../../../../components/RecoveryState'
import { TemplatesTabs } from '../../../../components/TemplatesTabs'
import { daemonClient } from '../../../../lib/daemon-client'

type SafeSlot = Omit<TeamTemplateSlot, 'display'> & { display: null }
type SafeRevision = Omit<TeamTemplateRevision, 'slots'> & { slots: SafeSlot[] }
type SafeDetail = Omit<TeamTemplateDetail, 'slots' | 'currentSnapshot'> & {
  slots: SafeSlot[]
  currentSnapshot: SafeRevision
}
type TeamLoaderResult =
  | { ok: true; value: { detail: SafeDetail; profiles: Profile[] } }
  | { ok: false; error: string }

const fetchTeam = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<TeamLoaderResult> => {
    try {
      const client = daemonClient()
      const [detail, profiles] = await Promise.all([
        client.get<TeamTemplateDetail>(`/api/team-templates/${encodeURIComponent(data.id)}`),
        client.get<Profile[]>('/api/profiles'),
      ])
      return {
        ok: true,
        value: {
          detail: {
            ...detail,
            slots: detail.slots.map((slot) => ({ ...slot, display: null })),
            currentSnapshot: {
              ...detail.currentSnapshot,
              slots: detail.currentSnapshot.slots.map((slot) => ({ ...slot, display: null })),
            },
          },
          profiles,
        },
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

export const Route = createFileRoute('/templates/teams/$id/')({
  loader: ({ params }) => fetchTeam({ data: params }),
  component: TeamDetailPage,
  errorComponent: ({ error, reset }) => <RecoveryState title="Team template unavailable" error={error} reset={reset} fallbackHref="/templates/teams" />,
})

function TeamDetailPage() {
  const result = Route.useLoaderData()
  if (!result.ok) {
    return <RecoveryState title="Team template unavailable" error={new Error(result.error)} reset={() => window.location.reload()} fallbackHref="/templates/teams" />
  }
  const { detail, profiles } = result.value
  return <PageShell size="wide"><TemplatesTabs /><p><a href="/templates/teams">← team templates</a></p>
    {detail.template.deletedAt && <div role="alert" className="err rounded-md border p-3">Source deleted — lineage is read-only and cannot be edited or spawned.</div>}
    <ProductionTeamPolicyEditor source={{ kind: 'template', detail }} profiles={profiles} />
    <p className="muted text-xs">Stable slot IDs remain distinct from live Agent IDs. Every successful save creates a new immutable revision; the reconciled editor badge is authoritative.</p>
  </PageShell>
}
