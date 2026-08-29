import type { ServiceCard, ServiceConfigResponse } from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { ConfigPage } from '../../components/ConfigPage'
import { FieldRow } from '../../components/FieldRow'
import { EmptyState, StatusBadge } from '../../components/Page'
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
          Connect optional tools such as web search and crawlers. Secret values are encrypted;
          endpoint details remain inspectable and editable on this device.
        </>
      }
    >
      {services.length === 0 && (
        <EmptyState
          title="No optional services"
          description="This Bazilion build has no additional service connectors registered."
        />
      )}

      {grouped.map(({ team, items }) => (
        <section key={team} className="space-y-3">
          <div>
            <h2 className="m-0 font-body text-base font-semibold text-foreground">{team}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Open only the service you want to configure.
            </p>
          </div>
          {items.map((service) => {
            const configured = service.fields.filter((field) => field.set).length
            return (
              <details
                key={service.id}
                open={configured > 0}
                className="overflow-hidden rounded-2xl border border-border bg-card shadow-baziu-sm"
              >
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-4 marker:hidden sm:px-5">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-foreground">{service.displayName}</span>
                    <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                      {service.id}
                    </span>
                  </span>
                  <StatusBadge variant={configured > 0 ? 'success' : 'neutral'}>
                    {configured > 0
                      ? `${configured} field${configured === 1 ? '' : 's'} configured`
                      : 'Not configured'}
                  </StatusBadge>
                </summary>
                <div className="border-t border-border px-4 py-4 sm:px-5">
                  {service.hint && (
                    <p className="mb-2 text-sm text-muted-foreground">{service.hint}</p>
                  )}
                  {service.fields.map((field) => (
                    <FieldRow key={field.envVar} field={field} />
                  ))}
                </div>
              </details>
            )
          })}
        </section>
      ))}
    </ConfigPage>
  )
}
