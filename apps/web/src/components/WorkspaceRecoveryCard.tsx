import type { WorkspaceRecoveryReport, WorkspaceRecoveryResponse } from '@bazilion/api-types'
import { WORKSPACE_RECOVERY_OUTCOME_TEXT, workspaceRecoveryExplanation } from '@bazilion/client'
import { createServerFn } from '@tanstack/react-start'
import { useEffect, useRef, useState } from 'react'
import { daemonClient } from '../lib/daemon-client'
import { Button } from './Button'

const readRecovery = createServerFn({ method: 'POST' })
  .validator((data: { teamId: string }) => data)
  .handler(({ data }) => daemonClient().workspaceRecovery(data.teamId).list())
const attemptRecovery = createServerFn({ method: 'POST' })
  .validator((data: { teamId: string; writerId: string }) => data)
  .handler(({ data }) => daemonClient().workspaceRecovery(data.teamId).attempt(data.writerId))

export function WorkspaceRecoveryCard({ teamId }: { teamId: string }) {
  const generation = useRef(0)
  const selectedTeam = useRef(teamId)
  selectedTeam.current = teamId
  const [report, setReport] = useState<WorkspaceRecoveryReport | null>(null)
  const [outcome, setOutcome] = useState<WorkspaceRecoveryResponse['outcome'] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    const epoch = ++generation.current
    setBusy(false)
    setReport(null)
    setOutcome(null)
    setError(false)
    readRecovery({ data: { teamId } })
      .then(value => { if (generation.current === epoch) setReport(value) })
      .catch(() => { if (generation.current === epoch) setError(true) })
    return () => { generation.current += 1 }
  }, [teamId])

  async function refresh() {
    if (busy) return
    const epoch = ++generation.current
    const current = () => epoch === generation.current && selectedTeam.current === teamId
    setBusy(true)
    setError(false)
    setOutcome(null)
    try {
      const value = await readRecovery({ data: { teamId } })
      if (current()) setReport(value)
    } catch {
      if (current()) setError(true)
    } finally {
      if (current()) setBusy(false)
    }
  }

  async function attempt(writerId: string) {
    if (busy) return
    const epoch = ++generation.current
    const current = () => epoch === generation.current && selectedTeam.current === teamId
    setBusy(true)
    setError(false)
    setOutcome(null)
    try {
      const result = await attemptRecovery({ data: { teamId, writerId } })
      if (current()) {
        setReport(result.report)
        setOutcome(result.outcome)
      }
    } catch {
      if (current()) setError(true)
    } finally {
      if (current()) setBusy(false)
    }
  }

  return <section className="my-4 space-y-3" aria-label="Workspace recovery">
    <div className="flex items-center justify-between gap-3">
      <h3 className="font-semibold">Workspace recovery</h3>
      <Button variant="ghost" disabled={busy} onClick={refresh}>Refresh status</Button>
    </div>
    <p className="text-sm text-muted-foreground">
      Owner-only recorded cleanup. Unknown or restored ownership stays blocked; there is no force-clear.
      Recovery of unconfirmed host-command cleanup is not supported in this release.
    </p>
    {error && <p role="alert">Recovery status unavailable. No cleanup confirmation.</p>}
    {outcome && <p role="status">{WORKSPACE_RECOVERY_OUTCOME_TEXT[outcome]}</p>}
    {report && report.writers.length === 0 && <p>No recorded writers. This is not a workspace verification.</p>}
    {report?.truncated && <p>Report truncated.</p>}
    {report?.writers.map(writer => <div key={writer.writerId} className="space-y-2 rounded border p-3">
      <div className="flex items-center gap-3 flex-wrap">
        <code>{writer.writerId}</code><span>{writer.posture}</span>
        <Button variant="ghost" disabled={busy || writer.posture !== 'recovery_required' || !!writer.blocker} onClick={() => attempt(writer.writerId)}>
          Attempt recorded cleanup
        </Button>
      </div>
      <p className="text-sm">{workspaceRecoveryExplanation(writer)}</p>
    </div>)}
  </section>
}
