import type { ExecutionSecurityReport } from '@bazilion/api-types'
import type { ReactNode } from 'react'

export function ExecutionSecurityCard({ status }: { status: ExecutionSecurityReport }) {
  const configured = status.configuredOperatorHttp
  const protectedTurns = status.protectedUnattendedTurns

  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <header className="border-b px-4 py-3">
        <h2 className="font-semibold">Execution security</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Operator HTTP requests keep their configured compatibility behavior. Unattended sources
          use a separate mandatory protected baseline.
        </p>
      </header>

      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <section className="rounded-md border bg-muted/20 p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Configured operator HTTP</h3>
            <StatusBadge ok={false}>legacy · unprotected</StatusBadge>
          </div>
          <dl className="space-y-2 text-sm">
            <StatusRow label="Coding surface" value={codingSurfaceLabel(configured.codingSurface)} />
            <StatusRow label="Docker image" value={configured.dockerImage} mono />
            <StatusRow label="Browser" value={configured.browser} />
            <StatusRow label="MCP" value={configured.mcp} />
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            This compatibility branch is for operator requests; Telegram and unattended delivery
            never select it.
          </p>
        </section>

        <section
          className={`rounded-md border p-3 ${
            protectedTurns.baseRuntimeReady
              ? 'border-success/25 bg-success/5'
              : 'border-warning/25 bg-warning/10'
          }`}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Protected unattended turns</h3>
            <StatusBadge ok={protectedTurns.baseRuntimeReady}>
              {protectedTurns.baseRuntimeReady
                ? 'base runtime ready'
                : 'base runtime unavailable'}
            </StatusBadge>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Telegram, schedules, inbox wake-ups, and approval delivery cannot select the legacy
            surface.
          </p>
          <dl className="space-y-2 text-sm">
            <StatusRow label="Coding surface" value="Docker only" />
            <StatusRow
              label="Docker"
              value={protectedTurns.docker.ready ? 'ready' : 'unavailable'}
              ok={protectedTurns.docker.ready}
            />
            <StatusRow label="Docker image" value={protectedTurns.docker.image} mono />
            {protectedTurns.docker.reason && (
              <StatusRow label="Docker reason" value={protectedTurns.docker.reason} />
            )}
            <StatusRow
              label="OpenAI Codex enabled"
              value={yesNo(protectedTurns.openaiCodex.enabled)}
              ok={protectedTurns.openaiCodex.enabled}
            />
            <StatusRow
              label="ChatGPT connected"
              value={yesNo(protectedTurns.openaiCodex.connected)}
              ok={protectedTurns.openaiCodex.connected}
            />
            <StatusRow
              label="OpenAI access"
              value={openAIAccessLabel(protectedTurns.openaiCodex)}
              ok={
                protectedTurns.openaiCodex.accessCurrent ||
                protectedTurns.openaiCodex.refreshOnNextTurn
              }
            />
            <StatusRow
              label="OpenAI Codex baseline eligible"
              value={yesNo(protectedTurns.openaiCodex.baselineEligible)}
              ok={protectedTurns.openaiCodex.baselineEligible}
            />
            <StatusRow label="Browser" value={protectedTurns.browser} ok />
            <StatusRow label="MCP" value={protectedTurns.mcp} ok />
          </dl>
          {protectedTurns.remediation && (
            <p className="mt-3 rounded-md border border-warning/25 bg-background/60 px-3 py-2 text-xs text-warning">
              <strong>Remediation:</strong> {protectedTurns.remediation}
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Every turn separately validates its selected normal/review model, bound OAuth refresh,
            and Team/input/memory/skill mounts and paths before execution.
          </p>
        </section>
      </div>
    </section>
  )
}

function StatusBadge({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${
        ok ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'
      }`}
    >
      {children}
    </span>
  )
}

function StatusRow({
  label,
  value,
  ok,
  mono = false,
}: {
  label: string
  value: string
  ok?: boolean
  mono?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={`${mono ? 'font-mono' : 'font-medium'} text-right ${
          ok === undefined ? '' : ok ? 'text-success' : 'text-warning'
        }`}
      >
        {value}
      </dd>
    </div>
  )
}

function codingSurfaceLabel(
  surface: ExecutionSecurityReport['configuredOperatorHttp']['codingSurface'],
) {
  if (surface === 'host') return 'Host tools'
  if (surface === 'docker') return 'Docker only'
  return 'Unavailable'
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no'
}

function openAIAccessLabel(
  status: ExecutionSecurityReport['protectedUnattendedTurns']['openaiCodex'],
): string {
  if (status.accessCurrent) return 'current'
  if (status.refreshOnNextTurn) return 'refresh on next turn'
  return 'unavailable'
}
