import type { Agent, ResultListResponse } from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useEffect, useState } from 'react'
import { Button } from '../../../components/Button'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { ResultCard } from '../../../components/ResultCard'
import { api, errorMessage } from '../../../lib/api'
import { daemonClient } from '../../../lib/daemon-client'

const PAGE = 20

const fetchAgentNames = createServerFn({ method: 'GET' }).handler(async () => {
  const agents = await daemonClient().get<Agent[]>('/api/agents?includeArchived=true')
  // Results outlive their Agent: only an Agent that still exists has a conversation to open.
  return Object.fromEntries(agents.map((agent) => [agent.id, agent.name])) as Record<string, string>
})

export const Route = createFileRoute('/teams/$id/results')({
  loader: () => fetchAgentNames(),
  component: ResultsPage,
})

function ResultsPage() {
  const agentNames = Route.useLoaderData()
  const { id: teamId } = Route.useParams()
  const [data, setData] = useState<ResultListResponse | null>(null)
  const [agentInput, setAgentInput] = useState('')
  const [filter, setFilter] = useState('')
  const [offset, setOffset] = useState(0)
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision is the reload signal.
  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ teamId, limit: String(PAGE), offset: String(offset) })
    if (filter) query.set('agentId', filter)
    setData(null)
    setError('')
    api<ResultListResponse>(`/api/results?${query}`, { signal: controller.signal })
      .then((page) => {
        // The last page emptied (a deletion): step back to the new last page.
        if (offset > 0 && offset >= page.total) {
          setOffset(Math.max(0, Math.floor((page.total - 1) / PAGE) * PAGE))
          return
        }
        setData(page)
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(errorMessage(cause))
      })
    return () => controller.abort()
  }, [teamId, filter, offset, revision])

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Files this Team's Agents delivered, saved with their original contents.
      </p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          setOffset(0)
          setFilter(agentInput.trim())
        }}
      >
        <label className="m-0 min-w-0">
          Producing Agent ID
          <input
            value={agentInput}
            onChange={(event) => setAgentInput(event.target.value)}
            placeholder="All Agents"
          />
        </label>
        <Button variant="ghost" type="submit">
          Filter
        </Button>
        <Button variant="ghost" onClick={() => setRevision((value) => value + 1)}>
          Refresh
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Loading results…</p>}
      {data && (
        <>
          {data.results.length === 0 && (
            <p>No saved results{filter ? ' for this Agent' : ' yet'}.</p>
          )}
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            {data.results.map((result) => {
              const agentName = agentNames[result.agentId]
              return (
                <article key={result.id} className="min-w-0 rounded-lg border border-fawn p-4">
                  <ResultCard resultId={result.id} result={result} showPreview />
                  <p className="break-all text-sm">
                    Agent: {result.agentId} ({agentName ?? 'deleted'})
                  </p>
                  <p className="text-sm">Saved: {new Date(result.createdAt).toLocaleString()}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {agentName ? (
                      <a
                        className="ghost-btn"
                        href={`/agents/${encodeURIComponent(result.agentId)}?conversation=${encodeURIComponent(result.sessionId)}`}
                      >
                        Open conversation
                      </a>
                    ) : (
                      <span className="text-sm text-mocha">Conversation unavailable</span>
                    )}
                    <Button
                      variant="danger"
                      onClick={() => setDeleting({ id: result.id, name: result.name })}
                    >
                      Delete saved file
                    </Button>
                  </div>
                </article>
              )
            })}
          </div>
          <nav className="flex flex-wrap items-center gap-3" aria-label="Results pagination">
            <Button
              variant="ghost"
              disabled={offset === 0}
              onClick={() => setOffset((value) => Math.max(0, value - PAGE))}
            >
              Previous
            </Button>
            <span>
              {data.total
                ? `${offset + 1}–${offset + data.results.length} of ${data.total}`
                : '0 results'}
            </span>
            <Button
              variant="ghost"
              disabled={offset + PAGE >= data.total}
              onClick={() => setOffset((value) => value + PAGE)}
            >
              Next
            </Button>
          </nav>
        </>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title="Delete saved file?"
        description={`Permanently delete the saved file “${deleting?.name ?? ''}”. The file in the workspace, if any, is unchanged.`}
        confirmLabel="Delete saved file"
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        onConfirm={async () => {
          if (!deleting) return
          await api(`/api/results/${encodeURIComponent(deleting.id)}`, { method: 'DELETE' })
          setOffset(0)
          setRevision((value) => value + 1)
        }}
      />
    </div>
  )
}
