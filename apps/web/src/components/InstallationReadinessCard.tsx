import type { HealthReport } from '@bazilion/api-types'

export type InstallationReadiness = Pick<
  HealthReport,
  'ok' | 'platformCapabilities' | 'protectedWorkBaselineReady'
>

export function InstallationReadinessCard({ report }: { report: InstallationReadiness }) {
  return (
    <section
      aria-label="Installation and platform support"
      className="overflow-hidden rounded-2xl border border-border bg-card shadow-baziu-sm"
    >
      <header className="border-b border-border px-4 py-3 sm:px-5">
        <h2 className="text-base font-semibold">Installation and platform support</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Daemon platform: {report.platformCapabilities.platform}. {report.platformCapabilities.note}
        </p>
      </header>
      <dl className="grid gap-4 border-b border-border p-4 sm:grid-cols-3 sm:px-5">
        <div>
          <dt className="text-xs text-muted-foreground">Installation health</dt>
          <dd className={`mt-1 font-semibold ${report.ok ? 'text-success' : 'text-warning'}`}>
            {report.ok ? 'Healthy' : 'Issues found'}
          </dd>
          <dd className="mt-1 text-xs text-muted-foreground">
            Structural checks only. Run bazilion doctor for details.
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Ordinary chat execution</dt>
          <dd className="mt-1 font-semibold">Not checked</dd>
          <dd className="mt-1 text-xs text-muted-foreground">
            Test your selected provider, then try an Agent chat.
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Protected unattended baseline</dt>
          <dd
            className={`mt-1 font-semibold ${report.protectedWorkBaselineReady ? 'text-success' : 'text-warning'}`}
          >
            {report.protectedWorkBaselineReady ? 'Ready · per-turn checks still apply' : 'Unavailable'}
          </dd>
          <dd className="mt-1 text-xs text-muted-foreground">
            See Execution security below for prerequisites and remediation. This is separate from
            installation health; protected turns never fall back to host execution.
          </dd>
        </div>
      </dl>
      <dl className="divide-y divide-border px-4 sm:px-5">
        {report.platformCapabilities.capabilities.map((capability) => (
          <div key={capability.id} className="grid gap-1 py-3 sm:grid-cols-2 sm:gap-4">
            <dt className="text-sm font-medium">{capability.label}</dt>
            <dd className="min-w-0 text-sm">
              <span className={capability.support === 'unsupported' ? 'text-warning' : ''}>
                {capability.support === 'supported' ? 'Supported' : 'Unsupported'} on this platform
              </span>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{capability.detail}</p>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
