// An Agent's helpers (BAZ-092): short runs of the same Agent it started for one task each, beside
// its own turn. Each works in a conversation of its own, which opens here; Stop ends one. They are
// kept in the daemon's memory, so the list starts over when Bazilion restarts.

import type { Agent, Helper, ListHelpersResponse } from '@bazilion/api-types'
import { Link } from '@tanstack/react-router'
import { Users } from 'lucide-react'
import { useState } from 'react'
import { useActivity } from '../../lib/activity'
import { api, errorMessage } from '../../lib/api'
import type { Tone } from '../../lib/model-facts'
import { useHydrated, useResource } from '../../lib/use-resource'
import { Button } from '../Button'
import { CardEmpty, CardList, Chip, ListRow, Notice, SetupCard } from '../ui/parts'
import { useWorkspace } from '../workspace/context'

function stateOf(helper: Helper): { label: string; tone: Tone } {
  if (helper.status === 'running') return { label: 'Working', tone: 'success' }
  if (helper.status === 'done') return { label: 'Done', tone: 'neutral' }
  if (helper.status === 'failed') return { label: 'Failed', tone: 'warning' }
  if (helper.stoppedBy === 'owner') return { label: 'Stopped by you', tone: 'neutral' }
  if (helper.stoppedBy === 'agent') return { label: 'Stopped by the Agent', tone: 'neutral' }
  return { label: 'Stopped with its turn', tone: 'neutral' }
}

export function AgentHelpers({ agent }: { agent: Agent }) {
  const activity = useActivity()
  // A helper that starts or ends changes the count, which loads the list again.
  const running = activity.byAgent.get(agent.id)?.helpers ?? 0
  const path = `/api/agents/${encodeURIComponent(agent.id)}/helpers`
  const data = useResource((signal) => api<ListHelpersResponse>(path, { signal }), [path], {
    refreshOn: running,
  })
  if (!data.data) {
    return data.error ? (
      <Notice role="alert" title="The helpers could not be loaded.">
        {data.error}
      </Notice>
    ) : (
      <p role="status" className="m-0 text-sm text-muted-foreground">
        Loading the helpers…
      </p>
    )
  }
  return (
    <HelpersView
      agentId={agent.id}
      agentName={agent.name}
      helpers={data.data.helpers}
      onChanged={data.reload}
    />
  )
}

export function HelpersView({
  agentId,
  agentName,
  helpers,
  onChanged,
}: {
  agentId: string
  agentName: string
  helpers: Helper[]
  onChanged: () => Promise<void>
}) {
  const hydrated = useHydrated()
  const { to } = useWorkspace()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const when = (at: number) => (hydrated ? new Date(at).toLocaleString() : '')

  async function stop(helper: Helper) {
    setError(null)
    setBusy(helper.id)
    try {
      await api(
        `/api/agents/${encodeURIComponent(agentId)}/helpers/${encodeURIComponent(helper.id)}/stop`,
        { method: 'POST', body: {} },
      )
      await onChanged()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <SetupCard
      labelledBy="agent-helpers"
      icon={<Users className="size-5" />}
      title="Helpers"
      description={`Runs of ${agentName} for one task each, beside its own turn. Each answers ${agentName} when it is done.`}
    >
      {error && (
        <div className="border-t border-border px-4 py-3 sm:px-5">
          <Notice role="alert" title="That did not work.">
            {error}
          </Notice>
        </div>
      )}
      {helpers.length === 0 ? (
        <CardEmpty icon={<Users className="size-5" />} title="No helpers since Bazilion started">
          When {agentName} splits work into tasks of their own, its helpers show here while they
          work.
        </CardEmpty>
      ) : (
        <CardList>
          {helpers.map((helper) => {
            const state = stateOf(helper)
            return (
              <ListRow
                key={helper.id}
                title={helper.task.split('\n')[0] ?? helper.id}
                chip={<Chip tone={state.tone}>{state.label}</Chip>}
                meta={
                  <>
                    {helper.status === 'running' && <span>Now {helper.activity}</span>}
                    <span>Started {when(helper.startedAt)}</span>
                    {helper.model && <span>{helper.model}</span>}
                  </>
                }
                actions={
                  <>
                    <Link
                      to="/"
                      search={to({ conversation: helper.conversationId, section: undefined })}
                      className="ghost-btn min-h-9"
                    >
                      Open
                    </Link>
                    {helper.status === 'running' && (
                      <Button
                        variant="danger"
                        disabled={busy === helper.id}
                        onClick={() => void stop(helper)}
                      >
                        Stop
                      </Button>
                    )}
                  </>
                }
              >
                {helper.status === 'failed' && helper.error && (
                  <p className="m-0 break-words text-sm text-danger">{helper.error}</p>
                )}
              </ListRow>
            )
          })}
        </CardList>
      )}
    </SetupCard>
  )
}
