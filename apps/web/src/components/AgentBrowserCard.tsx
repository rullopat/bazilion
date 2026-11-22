// The Agent's own browser, for pages that need a real one: whether it runs, the sign-ins it keeps,
// and how to stop it or start it afresh.

import type { BrowserMode, BrowserStatus } from '@bazilion/api-types'
import { Globe } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api, errorMessage } from '../lib/api'
import { Button } from './Button'
import { ConfirmDialog } from './ConfirmDialog'
import { CardBody, Chip, Fact, Facts, Notice, SetupCard } from './ui/parts'

const MODE: Record<BrowserMode, string> = {
  headless: 'without a window',
  headed: 'in a window',
  attached: 'your own, attached',
}

export function AgentBrowserCard({
  agentId,
  agentName = 'This Agent',
}: {
  agentId: string
  agentName?: string
}) {
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
    <SetupCard
      labelledBy="agent-browser"
      icon={<Globe className="size-5" />}
      title="Browser"
      description={`${agentName}’s own browser for pages that need one. It keeps its sign-ins between turns.`}
      action={
        <div className="flex items-center gap-2">
          {status &&
            (status.running ? (
              <Chip tone="success">Running</Chip>
            ) : (
              <Chip tone="neutral">Stopped</Chip>
            ))}
          <Button variant="ghost" disabled={busy} onClick={reload}>
            {loading ? 'Checking…' : 'Check again'}
          </Button>
        </div>
      }
    >
      {loading && !status && (
        <CardBody>
          <p role="status" className="m-0 text-sm text-muted-foreground">
            Checking the browser…
          </p>
        </CardBody>
      )}
      {status && (
        <Facts>
          <Fact label="Browser tools" tone={status.enabled ? undefined : 'warning'}>
            {status.enabled ? 'On' : 'Off in Setup → Tools'}
          </Fact>
          <Fact label="Saved sign-ins">
            {status.profilePresent ? 'Kept: cookies and sign-ins' : 'None yet'}
          </Fact>
          <Fact label="Browser" tone={status.browser ? undefined : 'warning'}>
            {status.browser ? `${status.browser.name}, ${MODE[status.browser.mode]}` : 'None found'}
          </Fact>
        </Facts>
      )}
      <CardBody>
        {status?.error && (
          <Notice title="The browser cannot run.">
            <span className="whitespace-pre-wrap">{status.error}</span>
          </Notice>
        )}
        {error && (
          <Notice role="alert" title="That did not work.">
            {error}
          </Notice>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            disabled={busy || !status?.running}
            onClick={() => void run('stop')}
          >
            {pending === 'stop' ? 'Stopping…' : 'Stop it'}
          </Button>
          <Button
            variant="ghost"
            disabled={busy || (!status?.profilePresent && !status?.running)}
            onClick={() => setConfirmReset(true)}
          >
            Forget its sign-ins…
          </Button>
        </div>
        <p className="m-0 text-xs leading-5 text-muted-foreground">
          Stopping it, archiving the Agent or moving it to another Team keeps the sign-ins;
          forgetting them or deleting the Agent removes them. Backups leave them out.
        </p>
      </CardBody>
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={`Forget ${agentName}’s sign-ins?`}
        description={
          <p className="m-0">
            The browser stops, and its cookies and sign-ins are deleted. The next page it opens
            starts signed out.
          </p>
        }
        confirmLabel="Forget the sign-ins"
        onConfirm={() => run('reset')}
      />
    </SetupCard>
  )
}
