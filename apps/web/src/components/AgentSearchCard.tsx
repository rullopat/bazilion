import type { OrdinarySearchStatus } from '@bazilion/api-types'
import { useEffect, useState } from 'react'
import { fetchAgentSearchStatus } from '../lib/web-search'
import { SectionCard } from './Page'
import { Button } from './Button'

export function AgentSearchCard({ agentId, model }: { agentId: string; model: string }) {
  const [status, setStatus] = useState<OrdinarySearchStatus | null>(null)
  const [error, setError] = useState(false)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let current = true
    setStatus(null)
    setError(false)
    void fetchAgentSearchStatus({ data: { agentId } }).then(
      value => { if (current) setStatus(value) },
      () => { if (current) setError(true) },
    )
    return () => { current = false }
  }, [agentId, model, refresh])
  return (
    <SectionCard title="Web discovery" description="Configuration only, not proof of search execution or source reading. Ordinary interactive turns only; browser reading is separate." actions={<Button variant="ghost" onClick={() => setRefresh(value => value + 1)}>Refresh status</Button>}>
      {error ? <p role="alert">Search readiness unavailable.</p> : status ? (
        <div className="space-y-2 text-sm">
          <p>{status.state} · {status.route ?? 'no route'} · {status.account ?? 'no account'}{status.model ? ` · ${status.model}` : ''}</p>
          <p className="break-words">{status.message}</p>
          <p>Change route, mode or disablement in Config → Web Search. Native routes are experimental until live qualification.</p>
        </div>
      ) : <p role="status">Loading search readiness…</p>}
    </SectionCard>
  )
}
