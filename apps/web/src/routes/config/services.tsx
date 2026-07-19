import type { ServiceCard, ServiceConfigResponse } from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { ConfigPage } from '../../components/ConfigPage'
import { FieldRow } from '../../components/FieldRow'
import { daemonClient } from '../../lib/daemon-client'

const UNGROUPED_LABEL = 'Other'

const fetchServices = createServerFn({ method: 'GET' }).handler(() =>
  daemonClient().get<ServiceConfigResponse>('/api/config/services'),
)

export const Route = createFileRoute('/config/services')({
  loader: () => fetchServices(),
  component: ServicesPage,
})

/**
 * Bucket services into teams while preserving the order each team first
 * appears in the daemon's SERVICES list. Cards without a `team` field land
 * in an "Other" bucket at the end.
 */
function groupServices(services: ServiceCard[]): { team: string; items: ServiceCard[] }[] {
  const buckets = new Map<string, ServiceCard[]>()
  for (const s of services) {
    const key = s.team ?? UNGROUPED_LABEL
    const bucket = buckets.get(key) ?? []
    bucket.push(s)
    buckets.set(key, bucket)
  }
  const entries = Array.from(buckets, ([team, items]) => ({ team, items }))
  if (entries.length > 1) {
    entries.sort((a, b) => {
      if (a.team === UNGROUPED_LABEL) return 1
      if (b.team === UNGROUPED_LABEL) return -1
      return 0
    })
  }
  return entries
}

function ServicesPage() {
  const { services } = Route.useLoaderData()
  const grouped = groupServices(services)
  return (
    <ConfigPage
      active="services"
      title="Services"
      description={
        <>
          Configure non-LLM integrations such as web search and crawlers. Secret fields are
          encrypted in the <code className="font-mono">secrets</code> table; URLs and IDs live
          in the <code className="font-mono">config</code> table.
        </>
      }
    >
      {services.length === 0 && (
        <p className="text-muted-foreground italic">(no services registered)</p>
      )}

      {grouped.map(({ team, items }) => (
        <section key={team}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {team}
          </h2>
          {items.map((s) => (
            <section key={s.id} className="rounded-lg border bg-card p-5 mb-3">
              <header className="mb-3 flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold">{s.id}</span>
                <span className="text-muted-foreground text-sm">· {s.displayName}</span>
              </header>
              {s.hint && <p className="text-xs text-muted-foreground mb-2">{s.hint}</p>}
              {s.fields.map((f) => (
                <FieldRow key={f.envVar} field={f} />
              ))}
            </section>
          ))}
        </section>
      ))}
    </ConfigPage>
  )
}
