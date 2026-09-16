// Per-Team specialist verification (BAZ-044). A request binds one captured change to a finite set of
// checks and one Team member. Requesting verification never runs anything: the daemon's verification
// state machine claims it, revalidates the change, and executes only the captured checks. This panel
// therefore shows a comparison and per-check outcomes — never a pass, and never a merge verdict.

import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '../../../components/Button'
import { PageShell } from '../../../components/Page'
import { TeamTabs } from '../../../components/TeamTabs'
import {
  cancelVerification,
  createVerification,
  fetchTeamVerifications,
  fetchVerification,
  type TeamVerificationsView,
} from '../../../lib/verification'

export const Route = createFileRoute('/teams/$id/verifications')({
  loader: async ({ params }) => {
    const data = await fetchTeamVerifications({ data: { id: params.id } })
    if (!data) throw redirect({ to: '/teams' })
    return data
  },
  component: VerificationsPage,
})

/** Three-valued and never a badge: "changed" proves the source moved, not that it was relevant. */
function applicabilityLabel(comparison: 'identical' | 'changed' | 'unknown'): string {
  if (comparison === 'identical') return 'unchanged since capture'
  if (comparison === 'changed') return 'changed since capture — re-verify'
  return 'not checked'
}

function outcomeLabel(state: string, exitCode: number | null): string {
  if (state === 'not_executed') return 'not run'
  if (state === 'succeeded') return `ok${exitCode === null ? '' : ` (exit ${exitCode})`}`
  if (state === 'failed') return `failed${exitCode === null ? '' : ` (exit ${exitCode})`}`
  return state.replace(/_/g, ' ')
}

function VerificationsPage() {
  const loaded: TeamVerificationsView = Route.useLoaderData()
  const teamId = Route.useParams().id
  const [requests, setRequests] = useState(loaded.requests)
  const [unavailable, setUnavailable] = useState(loaded.unavailable)
  const [agentId, setAgentId] = useState(() => loaded.members[0]?.id ?? '')
  const [snapshotId, setSnapshotId] = useState('')
  const [checks, setChecks] = useState('pnpm test :: unit suite')
  const [summary, setSummary] = useState('')
  const [status, setStatus] = useState<{ kind: 'info' | 'error'; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  // Applicability is asked for per request: comparing the live tree is real work, and a list that
  // computed it for every row would walk the repository once per request.
  const [applicability, setApplicability] = useState<Record<string, string>>({})

  async function reload() {
    const next = await fetchTeamVerifications({ data: { id: teamId } })
    if (next) {
      setRequests(next.requests)
      setUnavailable(next.unavailable)
    }
  }

  async function request() {
    setBusy(true)
    setStatus({ kind: 'info', message: 'Capturing the request…' })
    try {
      const parsed = checks
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [command, purpose, cwd, seconds] = line.split('::').map((part) => part?.trim())
          return {
            command: command ?? '',
            purpose: purpose ?? '',
            cwd: cwd || '.',
            timeoutMs: Math.round((seconds ? Number(seconds) : 120) * 1000),
          }
        })
      const result = await createVerification({
        data: {
          id: teamId,
          recipientAgentId: agentId,
          snapshotId,
          checks: parsed,
          ...(summary ? { summary } : {}),
        },
      })
      if ('blocker' in result && result.blocker) {
        setStatus({ kind: 'error', message: `Blocked: ${result.blocker.detail}` })
        return
      }
      if ('ok' in result && result.ok) {
        setStatus({ kind: 'info', message: 'Captured. The specialist is admitted by the scheduler.' })
        setSnapshotId('')
        await reload()
        return
      }
      setStatus({
        kind: 'error',
        message: 'message' in result ? (result.message ?? 'Request failed') : 'Request failed',
      })
    } finally {
      setBusy(false)
    }
  }

  async function checkApplicability(requestId: string) {
    setBusy(true)
    try {
      const result = await fetchVerification({ data: { id: teamId, requestId } })
      setApplicability((current) => ({
        ...current,
        [requestId]:
          'report' in result
            ? applicabilityLabel(result.report.applicability.comparison)
            : 'unavailable',
      }))
    } finally {
      setBusy(false)
    }
  }

  async function cancel(requestId: string) {
    setBusy(true)
    try {
      const result = await cancelVerification({ data: { id: teamId, requestId } })
      setStatus(
        result.ok
          ? { kind: 'info', message: 'Cancellation requested.' }
          : { kind: 'error', message: result.message ?? 'Cancel failed' },
      )
      await reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageShell>
      <TeamTabs teamId={teamId} />
      <h2>Specialist verification</h2>
      {unavailable ? <p className="muted">{unavailable.message}</p> : null}
      {status ? (
        <p className={status.kind === 'error' ? 'error' : 'muted'} role="status">
          {status.message}
        </p>
      ) : null}

      <section aria-label="Request verification" className="card">
        <h3>Request verification of a captured change</h3>
        <p className="muted">
          Capture a source snapshot on the{' '}
          <Link to="/teams/$id/review" params={{ id: teamId }}>
            Review
          </Link>{' '}
          page first, then name it here with the checks you want run. Nothing runs until the daemon
          admits the request.
        </p>
        <label>
          Specialist
          <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
            {loaded.members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Snapshot id
          <input
            value={snapshotId}
            onChange={(event) => setSnapshotId(event.target.value)}
            placeholder="captured snapshot id"
          />
        </label>
        <label>
          Checks (one per line: command :: purpose [:: cwd] [:: seconds])
          <textarea value={checks} onChange={(event) => setChecks(event.target.value)} rows={4} />
        </label>
        <label>
          Acceptance summary (optional)
          <input value={summary} onChange={(event) => setSummary(event.target.value)} />
        </label>
        <Button
          variant="primary"
          disabled={busy || !agentId || !snapshotId || !checks.trim()}
          onClick={request}
        >
          Request verification
        </Button>
      </section>

      <section aria-label="Verification requests">
        <h3>Requests</h3>
        {requests.length === 0 ? (
          <p className="muted">No verification requests yet.</p>
        ) : (
          <ul className="list">
            {requests.map((report) => {
              const attempt = [...report.attempts].sort(
                (a, b) => b.attemptNumber - a.attemptNumber,
              )[0]
              const outcomes = new Map(
                (attempt?.outcomes ?? []).map((outcome) => [outcome.ordinal, outcome]),
              )
              const cancellable =
                report.request.state === 'pending' ||
                report.request.state === 'awaiting_approval' ||
                report.request.state === 'running'
              return (
                <li key={report.request.id} className="card">
                  <div>
                    <strong>{report.request.state}</strong>{' '}
                    <span className="muted">
                      {report.request.recipientAgentId} · {report.request.id}
                    </span>
                  </div>
                  <p className="muted">
                    change {report.request.snapshot.id.slice(0, 12)} ·{' '}
                    {report.request.environment.image} (shell {report.request.environment.sandbox})
                  </p>
                  <ul>
                    {report.checks.map((check) => {
                      const outcome = outcomes.get(check.ordinal)
                      return (
                        <li key={check.ordinal}>
                          [{check.ordinal}] {outcomeLabel(outcome?.state ?? 'not_executed', outcome?.exitCode ?? null)}{' '}
                          — <code>{check.command}</code>
                          {outcome?.commandId ? (
                            <>
                              {' '}
                              <span className="muted">receipt {outcome.commandId.slice(0, 8)}</span>
                            </>
                          ) : outcome?.receiptUnavailable ? (
                            <>
                              {' '}
                              <span className="muted">receipt no longer available</span>
                            </>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                  {attempt?.error ? <p className="muted">note: {attempt.error}</p> : null}
                  <p className="muted">
                    applicability: {applicability[report.request.id] ?? 'not checked'}
                  </p>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => checkApplicability(report.request.id)}
                  >
                    Check applicability
                  </Button>{' '}
                  {cancellable ? (
                    <Button variant="danger" disabled={busy} onClick={() => cancel(report.request.id)}>
                      Cancel
                    </Button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </PageShell>
  )
}
