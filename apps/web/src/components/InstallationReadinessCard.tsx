import type { HealthReport } from '@bazilion/api-types'

export type InstallationReadiness = Pick<HealthReport, 'ok'>

export function InstallationReadinessCard({ report }: { report: InstallationReadiness }) {
  return (
    <section
      aria-label="Installation health"
      className="overflow-hidden rounded-2xl border border-border bg-card shadow-baziu-sm"
    >
      <header className="border-b border-border px-4 py-3 sm:px-5">
        <h2 className="text-base font-semibold">Installation health</h2>
      </header>
      <dl className="p-4 sm:px-5">
        <dt className="text-xs text-muted-foreground">Installation health</dt>
        <dd className={`mt-1 font-semibold ${report.ok ? 'text-success' : 'text-warning'}`}>
          {report.ok ? 'Healthy' : 'Issues found'}
        </dd>
        <dd className="mt-1 text-xs text-muted-foreground">Run bazilion doctor for the details.</dd>
      </dl>
    </section>
  )
}
