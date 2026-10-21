import type { BrowserStatus } from '@bazilion/api-types'
import { useCallback, useEffect, useState } from 'react'
import { Button } from './Button'
import { ConfirmDialog } from './ConfirmDialog'
import { SectionCard } from './Page'
import {
  fetchAgentBrowser,
  resetAgentBrowser,
  stopAgentBrowser,
  type AgentBrowserView,
} from '../lib/browser'

interface Props {
  agentId: string
}

function StateLine({ status }: { status: BrowserStatus }) {
  const availability =
    status.availability === 'configured'
      ? 'Browser configured'
      : status.availability === 'disabled'
        ? 'Browser tools disabled'
        : 'Browser unavailable'
  const selected = status.selectedBrowser
  return (
    <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
      <dt className="font-medium text-mocha">Availability</dt>
      <dd>{availability}</dd>
      <dt className="font-medium text-mocha">Session</dt>
      <dd>{status.state}</dd>
      <dt className="font-medium text-mocha">Profile</dt>
      <dd>{status.profilePresent ? 'Persistent profile exists' : 'No profile slot'}</dd>
      <dt className="font-medium text-mocha">Selected browser</dt>
      <dd className="break-words">
        {selected
          ? `${selected.name} · ${selected.source} · ${selected.mode}${selected.version ? ` · ${selected.version}` : ''}`
          : 'No usable browser selection'}
      </dd>
      {status.reasonCode && (
        <>
          <dt className="font-medium text-mocha">State code</dt>
          <dd className="break-words font-mono text-xs">{status.reasonCode}</dd>
        </>
      )}
    </dl>
  )
}

export function AgentBrowserCard({ agentId }: Props) {
  const [view, setView] = useState<AgentBrowserView | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<'stop' | 'reset' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setView(await fetchAgentBrowser({ data: { agentId } }))
    } catch (err) {
      setView({
        status: null,
        unavailable: { message: err instanceof Error ? err.message : String(err) },
      })
    } finally {
      setLoading(false)
    }
  }, [agentId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function stop() {
    setPending('stop')
    setError(null)
    try {
      const result = await stopAgentBrowser({ data: { agentId } })
      if (!result.ok) setError(`${result.failure.message}${result.failure.code ? ` (${result.failure.code})` : ''}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      await refresh()
      setPending(null)
    }
  }

  async function reset() {
    setPending('reset')
    setError(null)
    try {
      const result = await resetAgentBrowser({ data: { agentId } })
      if (!result.ok) {
        throw new Error(
          `${result.failure.message}${result.failure.code ? ` (${result.failure.code})` : ''}`,
        )
      }
    } finally {
      // A 409 or a reset from another client may have changed lifecycle state;
      // always refresh instead of leaving optimistic/stale status behind.
      await refresh()
      setPending(null)
    }
  }

  const status = view?.status ?? null
  const unavailable = view?.unavailable ?? null
  const busy = pending !== null || loading

  return (
    <SectionCard
      title="Managed browser"
      description="Isolated persistent browser session. Availability does not guarantee that a particular site will load."
      actions={
        <Button variant="ghost" disabled={busy} onClick={() => void refresh()}>
          {loading ? 'refreshing…' : 'refresh status'}
        </Button>
      }
    >
      <div className="space-y-4">
        {loading && !view && <p role="status">Loading browser status…</p>}
        {unavailable && (
          <div role="alert" className="rounded-md border border-warning/30 bg-fawn/30 p-3 text-sm">
            <strong>{unavailable.code ? `${unavailable.code}: ` : ''}</strong>
            {unavailable.message}
          </div>
        )}
        {status && <StateLine status={status} />}
        {status?.remedy && (
          <p className="break-words rounded-md bg-fawn/35 p-3 text-sm text-chocolate">
            {status.remedy}
          </p>
        )}
        {error && <p role="alert" className="err break-words">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            disabled={busy || status?.state !== 'running'}
            onClick={() => void stop()}
          >
            {pending === 'stop' ? 'stopping…' : 'Stop session'}
          </Button>
          <Button
            variant="danger"
            disabled={busy || (!status?.profilePresent && status?.state !== 'running')}
            onClick={() => setConfirmReset(true)}
          >
            Reset profile
          </Button>
        </div>
        <p className="text-xs leading-5 text-mocha-light">
          Stop and archive preserve the profile. Reset and Team transfer remove it (cookies and
          logins are lost). Browser state is excluded from backup. A site may still block or
          challenge an otherwise available browser.
        </p>
      </div>
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset this Agent’s browser profile?"
        description={
          <p>
            This stops the session and permanently removes this Agent’s isolated profile, including
            cookies and logins. This cannot be undone. Stop preserves the profile; use reset only
            when you intend to discard that site state.
          </p>
        }
        confirmLabel={pending === 'reset' ? 'resetting…' : 'delete profile'}
        onConfirm={reset}
      />
    </SectionCard>
  )
}
