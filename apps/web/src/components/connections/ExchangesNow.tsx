// The exchanges between a Team's Agents going on now, each with what it has used so far and a way
// to stop it. Nothing shows while none is going on.

import {
  type ActiveExchange,
  type ListExchangesResponse,
  type StopExchangeResponse,
  usageSummary,
} from '@bazilion/api-types'
import { useState } from 'react'
import { shortTime, useActivity } from '../../lib/activity'
import { api, errorMessage } from '../../lib/api'
import { useResource } from '../../lib/use-resource'
import { Button } from '../Button'
import { PanelGroup, PanelHeading } from '../panel/SidePanel'
import { useWorkspace } from '../workspace/context'

/** Names in a sentence: `A`, `A and B`, `A, B and C`. */
function namesOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

export function ExchangesNow({ teamId, memberIds }: { teamId: string; memberIds: string[] }) {
  const { agentById } = useWorkspace()
  const { turnsEnded, stateOf } = useActivity()
  // A turn that starts or ends may start, carry on or end an exchange.
  const working = memberIds.filter((id) => stateOf(id).kind === 'working').join(',')
  const exchanges = useResource(
    (signal) =>
      api<ListExchangesResponse>(`/api/teams/${encodeURIComponent(teamId)}/exchanges`, {
        signal,
      }).then((body) => body.exchanges),
    [teamId],
    { refreshOn: `${turnsEnded}:${working}` },
  )
  const [stopping, setStopping] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function stop(exchange: ActiveExchange) {
    setStopping(exchange.id)
    setError(null)
    try {
      await api<StopExchangeResponse>(`/api/exchanges/${encodeURIComponent(exchange.id)}/stop`, {
        method: 'POST',
      })
      await exchanges.reload()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setStopping(null)
    }
  }

  const list = exchanges.data ?? []
  if (list.length === 0) return null
  const name = (id: string) => agentById(id)?.name ?? id.slice(0, 8)
  return (
    // The heading is the section's first child, so the section keeps the space above it.
    <section aria-labelledby="exchanges-now" className="mt-5">
      <PanelHeading>
        <span id="exchanges-now">Going on now</span>
      </PanelHeading>
      <PanelGroup>
        {list.map((exchange) => {
          const agents = namesOf(exchange.agentIds.map(name))
          const running = exchange.runningAgentIds.map(name)
          return (
            <div key={exchange.id} className="flex items-start gap-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="m-0 text-sm font-semibold text-foreground">{agents}</p>
                <p className="m-0 mt-0.5 text-xs text-muted-foreground">
                  {exchange.messages} {exchange.messages === 1 ? 'message' : 'messages'} since{' '}
                  {shortTime(exchange.startedAt)}
                  {exchange.used.calls > 0 && ` · ${usageSummary(exchange.used)}`}
                </p>
                <p className="m-0 mt-0.5 text-xs text-mocha">
                  {running.length > 0
                    ? `${namesOf(running)} ${running.length === 1 ? 'is' : 'are'} working on it`
                    : 'A message is waiting to be read'}
                </p>
              </div>
              <Button
                variant="ghost"
                className="min-h-8 shrink-0 px-3 py-1 text-xs"
                aria-label={`Stop the exchange of ${agents}`}
                disabled={stopping === exchange.id}
                onClick={() => void stop(exchange)}
              >
                {stopping === exchange.id ? 'Stopping…' : 'Stop'}
              </Button>
            </div>
          )
        })}
      </PanelGroup>
      {error && (
        <p role="alert" className="m-0 mt-1.5 text-xs text-danger">
          {error}
        </p>
      )}
    </section>
  )
}
