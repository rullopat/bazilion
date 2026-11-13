import type { ServiceCard, ServiceConfigResponse } from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { ConfigPage } from '../../components/ConfigPage'
import { FieldRow } from '../../components/FieldRow'
import { EmptyState, StatusBadge } from '../../components/Page'
import { daemonClient } from '../../lib/daemon-client'

const OTHER = 'Other'

const fetchServices = createServerFn({ method: 'GET' }).handler(() =>
  daemonClient().get<ServiceConfigResponse>('/api/config/services'),
)

export const Route = createFileRoute('/config/services')({
  loader: () => fetchServices(),
  component: ServicesPage,
})

/** Services by group, in the order the daemon lists them; ungrouped ones go last. */
function groupServices(services: ServiceCard[]): { group: string; items: ServiceCard[] }[] {
  const groups = new Map<string, ServiceCard[]>()
  for (const service of services) {
    // The wire calls a service's group `team`.
    const group = service.team ?? OTHER
    groups.set(group, [...(groups.get(group) ?? []), service])
  }
  return Array.from(groups, ([group, items]) => ({ group, items })).sort(
    (a, b) => Number(a.group === OTHER) - Number(b.group === OTHER),
  )
}

function ServicesPage() {
  const { services } = Route.useLoaderData()
  return (
    <ConfigPage
      title="Services"
      description="Optional tools such as web search, crawlers and the browser. Secret values are stored encrypted."
    >
      {services.length === 0 && (
        <EmptyState
          title="No optional services"
          description="This Bazilion build has no service connectors."
        />
      )}

      {groupServices(services).map(({ group, items }) => (
        <section key={group} className="space-y-3">
          <h2 className="m-0 font-body text-base font-semibold text-foreground">{group}</h2>
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
                    <span className="block font-semibold text-foreground">
                      {service.displayName}
                    </span>
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
                  {service.status && (
                    <p role="status" className="mb-2 text-sm">
                      {service.status}
                    </p>
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
