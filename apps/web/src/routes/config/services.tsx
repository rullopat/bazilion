import type { ServiceConfigResponse } from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { ConfigTabs } from '../../components/ConfigTabs'
import { FieldRow } from '../../components/FieldRow'
import { daemonClient } from '../../lib/daemon-client'

const fetchServices = createServerFn({ method: 'GET' }).handler(() =>
  daemonClient().get<ServiceConfigResponse>('/api/config/services'),
)

export const Route = createFileRoute('/config/services')({
  loader: () => fetchServices(),
  component: ServicesPage,
})

function ServicesPage() {
  const { services } = Route.useLoaderData()
  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="font-serif text-3xl text-foreground mb-2">config</h1>
      <ConfigTabs active="services" />

      <p className="text-muted-foreground text-sm mb-6">
        Configuration for non-LLM integrations — web search, crawlers, and similar. Fields
        marked as secrets are encrypted in the <code className="font-mono">secrets</code>{' '}
        table; plaintext URLs and IDs live in the <code className="font-mono">config</code>{' '}
        table.
      </p>

      {services.length === 0 && (
        <p className="text-muted-foreground italic">(no services registered)</p>
      )}

      {services.map((s) => (
        <section key={s.id} className="rounded-lg border bg-card p-5 mb-3">
          <header className="flex items-center gap-2 mb-3">
            <span className="font-mono font-semibold">{s.id}</span>
            <span className="text-muted-foreground text-sm">· {s.displayName}</span>
          </header>
          {s.hint && <p className="text-xs text-muted-foreground mb-2">{s.hint}</p>}
          {s.fields.map((f) => (
            <FieldRow key={f.envVar} field={f} />
          ))}
        </section>
      ))}
    </main>
  )
}
