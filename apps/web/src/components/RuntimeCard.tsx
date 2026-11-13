import type { HealthReport } from '@bazilion/api-types'

/** Sandbox and approval apply the same way to every turn: chat, Telegram, schedules and inbox. */
export function RuntimeCard({ shell }: { shell: HealthReport['shellSecurity'] }) {
  return (
    <section
      aria-label="Agent runtime"
      className="overflow-hidden rounded-2xl border border-border bg-card shadow-baziu-sm"
    >
      <header className="border-b border-border px-4 py-3 sm:px-5">
        <h2 className="text-base font-semibold">Agent runtime</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Applies to every turn: chat, Telegram, schedules and inbox. Unattended turns auto-deny
          dangerous commands.
        </p>
      </header>
      {shell.ok ? (
        <dl className="divide-y divide-border px-4 text-sm sm:px-5">
          <Row
            label="Sandbox"
            value={
              shell.sandboxMode === 'docker'
                ? `Docker (${shell.sandboxImage}) — bash in a network-disabled container`
                : 'Off — bash and file tools run on the host, unisolated'
            }
          />
          {shell.docker && (
            <Row
              label="Docker"
              value={shell.docker.ready ? 'Ready' : `Unavailable — ${shell.docker.reason}`}
              ok={shell.docker.ready}
            />
          )}
          {shell.docker?.remediation && (
            <Row label="Remediation" value={shell.docker.remediation} />
          )}
          <Row
            label="Dangerous-command approval"
            value={
              shell.approvalMode === 'dangerous'
                ? 'On — chat can allow once; unattended turns auto-deny'
                : 'Off'
            }
          />
        </dl>
      ) : (
        <p role="alert" className="px-4 py-3 text-sm text-warning sm:px-5">
          Invalid shell-security configuration: {shell.error}
        </p>
      )}
    </section>
  )
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[14rem_1fr] sm:gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={ok === undefined ? 'font-medium' : ok ? 'text-success' : 'text-warning'}>
        {value}
      </dd>
    </div>
  )
}
