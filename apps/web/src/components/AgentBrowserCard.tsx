import type { BrowserStatus } from '@bazilion/api-types'
import { useCallback, useEffect, useState } from 'react'
import { api, errorMessage } from '../lib/api'
import { Button } from './Button'
import { ConfirmDialog } from './ConfirmDialog'
import { SectionCard } from './Page'

function StatusList({ status }: { status: BrowserStatus }) {
  return (
    <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
      <dt className="font-medium text-mocha">Browser tools</dt>
      <dd>{status.enabled ? 'Enabled' : 'Disabled'}</dd>
      <dt className="font-medium text-mocha">Session</dt>
      <dd>{status.running ? 'Running' : 'Stopped'}</dd>
      <dt className="font-medium text-mocha">Profile</dt>
      <dd>{status.profilePresent ? 'Saved (cookies and logins)' : 'None yet'}</dd>
      <dt className="font-medium text-mocha">Browser</dt>
      <dd className="break-words">
        {status.browser ? `${status.browser.name} · ${status.browser.mode}` : 'None found'}
      </dd>
    </dl>
  )
}

/** The Agent's persistent managed browser: status, stop and profile reset. */
export function AgentBrowserCard({ agentId }: { agentId: string }) {
  const path = `/api/agents/${encodeURIComponent(agentId)}/browser`
  const [status, setStatus] = useState<BrowserStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<'stop' | 'reset' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setStatus(await api<BrowserStatus>(path))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [path])

  // Loading or refreshing by hand starts clean; run() keeps a failed stop or reset on screen.
  const reload = useCallback(() => {
    setError(null)
    void refresh()
  }, [refresh])

  useEffect(() => {
    reload()
  }, [reload])

  async function run(action: 'stop' | 'reset') {
    setPending(action)
    setError(null)
    try {
      if (action === 'stop') await api(`${path}/stop`, { method: 'POST' })
      else await api(`${path}/profile`, { method: 'DELETE' })
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      await refresh()
      setPending(null)
    }
  }

  const busy = pending !== null || loading

  return (
    <SectionCard
      title="Managed browser"
      description="This Agent's own persistent browser, used by its browser_* tools."
      actions={
        <Button variant="ghost" disabled={busy} onClick={reload}>
          {loading ? 'Refreshing…' : 'Refresh status'}
        </Button>
      }
    >
      <div className="space-y-4">
        {loading && !status && <p role="status">Loading browser status…</p>}
        {status && <StatusList status={status} />}
        {status?.error && (
          <p className="whitespace-pre-wrap break-words rounded-md bg-fawn/35 p-3 text-sm text-chocolate">
            {status.error}
          </p>
        )}
        {error && (
          <p role="alert" className="err break-words">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            disabled={busy || !status?.running}
            onClick={() => void run('stop')}
          >
            {pending === 'stop' ? 'Stopping…' : 'Stop session'}
          </Button>
          <Button
            variant="danger"
            disabled={busy || (!status?.profilePresent && !status?.running)}
            onClick={() => setConfirmReset(true)}
          >
            Reset profile
          </Button>
        </div>
        <p className="text-xs leading-5 text-mocha-light">
          Stopping, archiving and moving the Agent to another Team keep the profile; Reset and
          deleting the Agent remove it. Browser profiles are not included in backups.
        </p>
      </div>
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset this Agent's browser profile?"
        description={
          <p>
            This stops the browser and permanently deletes this Agent's profile, including cookies
            and logins.
          </p>
        }
        confirmLabel="Delete profile"
        onConfirm={() => run('reset')}
      />
    </SectionCard>
  )
}
