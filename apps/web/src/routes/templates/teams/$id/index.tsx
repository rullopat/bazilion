import type { HarnessTemplate, HarnessTemplateRevision } from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { TemplatesTabs } from '../../../../components/TemplatesTabs'
import { RecoveryState } from '../../../../components/RecoveryState'
import { daemonClient } from '../../../../lib/daemon-client'

interface TeamSlotProjection {
  slotId: string
  position: number
  profileId: string
  agentName: string
}

interface TeamProjection {
  template: HarnessTemplate
  slots: TeamSlotProjection[]
  edgeCount: number
  snapshotRevision: number
}

const fetchTeam = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<TeamProjection> => {
    const detail = await daemonClient().get<{
      template: HarnessTemplate
      slots: TeamSlotProjection[]
      edges: unknown[]
      currentSnapshot: HarnessTemplateRevision
    }>(`/api/harness-templates/${encodeURIComponent(data.id)}`)
    return {
      template: detail.template,
      slots: detail.slots.map(({ slotId, position, profileId, agentName }) => ({
        slotId,
        position,
        profileId,
        agentName,
      })),
      edgeCount: detail.edges.length,
      snapshotRevision: detail.currentSnapshot.revision,
    }
  })

export const Route = createFileRoute('/templates/teams/$id/')({
  loader: ({ params }) => fetchTeam({ data: params }),
  component: TeamDetailPage,
  errorComponent: ({ error, reset }) => <RecoveryState title="Team template unavailable" error={error} reset={reset} fallbackHref="/templates/teams" />,
})

function TeamDetailPage() {
  const detail = Route.useLoaderData()
  const { template } = detail
  return (
    <div>
      <TemplatesTabs />
      <p><a href="/templates/teams">← team templates</a></p>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>{template.name}</h1>
          <p className="muted"><code>{template.id}</code> · revision {template.currentRevision} · {detail.slots.length} stable slots</p>
        </div>
        {template.deletedAt && <span className="err">Source deleted — lineage is read-only</span>}
      </div>
      <section className="card">
        <h2 className="text-xl">canonical roster</h2>
        <p className="muted">This is the only reusable Team roster. The production Flow/Matrix editor mounts here in BAZ-017.</p>
        <div className="overflow-x-auto">
          <table>
            <thead><tr><th>position</th><th>agent name</th><th>agent template</th><th>stable slot</th></tr></thead>
            <tbody>
              {detail.slots.map((slot) => <tr key={slot.slotId}><td>{slot.position + 1}</td><td>{slot.agentName}</td><td><a href={`/templates/agents/${encodeURIComponent(slot.profileId)}`}>{slot.profileId}</a></td><td><code>{slot.slotId}</code></td></tr>)}
              {detail.slots.length === 0 && <tr><td colSpan={4} className="muted">No slots yet. Add slots in the BAZ-017 editor.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <h2 className="text-xl">policy snapshot</h2>
        <p>{detail.edgeCount} directed allow edges in immutable revision {detail.snapshotRevision}.</p>
        <p className="muted">Spawn and adoption actions must submit template revision {template.currentRevision}; stale source revisions are never silently accepted.</p>
      </section>
    </div>
  )
}
