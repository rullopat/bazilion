import type { ResultListResponse, Team } from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useEffect, useState } from 'react'
import { Button } from '../../../components/Button'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { PageShell } from '../../../components/Page'
import { ResultSourceLink } from '../../../components/ResultSourceConversation'
import { ResultCard } from '../../../components/ResultCard'
import { TeamTabs } from '../../../components/TeamTabs'
import { daemonClient } from '../../../lib/daemon-client'

const fetchTeam = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) =>
    daemonClient().get<Team>(`/api/teams/${encodeURIComponent(data.id)}`),
  )
export const Route = createFileRoute('/teams/$id/results')({
  loader: ({ params }) => fetchTeam({ data: { id: params.id } }),
  component: ResultsPage,
})
function ResultsPage() {
  const team = Route.useLoaderData()
  const [data, setData] = useState<ResultListResponse | null>(null)
  const [agent, setAgent] = useState('')
  const [filter, setFilter] = useState('')
  const [offset, setOffset] = useState(0)
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ teamId: team.id, limit: '20', offset: String(offset) })
    if (filter) query.set('agentId', filter)
    setData(null)
    setError('')
    fetch(`/api/results?${query}`, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error('Could not load saved results.')
        const page = (await r.json()) as ResultListResponse
        if (controller.signal.aborted) return
        if (offset > 0 && offset >= page.total) {
          setOffset(Math.max(0, Math.floor((page.total - 1) / 20) * 20))
          return
        }
        setData(page)
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message)
      })
    return () => controller.abort()
  }, [team.id, filter, offset, revision])
  return (
    <PageShell>
      <header>
        <h1>{team.name || team.id} results</h1>
        <p>Files delivered by this Team, saved with their original contents.</p>
      </header>
      <TeamTabs teamId={team.id} />
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          setOffset(0)
          setFilter(agent.trim())
        }}
      >
        <label className="min-w-0">
          Producing Agent ID
          <input
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            placeholder="All Agents"
            className="block max-w-full"
          />
        </label>
        <Button variant="ghost" type="submit">
          Filter
        </Button>
        <Button variant="ghost" onClick={() => setRevision((v) => v + 1)}>
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
          {!data.results.length && <p>No saved results{filter ? ' for this Agent' : ' yet'}.</p>}
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            {data.results.map((result) => (
              <article key={result.id} className="min-w-0 rounded-lg border border-fawn p-4">
                <ResultCard resultId={result.id} showPreview />
                <p className="break-all text-sm">Agent: {result.agentId}</p>
                <p className="text-sm">Saved: {new Date(result.createdAt).toLocaleString()}</p>
                <p className="break-all text-sm">Conversation: {result.sessionId}</p>
                <div className="flex flex-wrap gap-2">
                  <ResultSourceLink resultId={result.id} agentId={result.agentId} />
                  <Button
                    variant="danger"
                    onClick={() => setDeleting({ id: result.id, name: result.name })}
                  >
                    Delete saved file
                  </Button>
                </div>
              </article>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3" aria-label="Results pagination">
            <Button
              variant="ghost"
              disabled={offset === 0}
              onClick={() => setOffset((v) => Math.max(0, v - 20))}
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
              disabled={offset + 20 >= data.total}
              onClick={() => setOffset((v) => v + 20)}
            >
              Next
            </Button>
          </div>
        </>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title="Delete saved file?"
        description={`Permanently delete the saved bytes of “${deleting?.name ?? ''}”. History will show a deletion receipt. The workspace source file is unchanged.`}
        confirmLabel="Delete saved file"
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        onConfirm={async () => {
          if (!deleting) return
          const response = await fetch(`/api/results/${encodeURIComponent(deleting.id)}`, {
            method: 'DELETE',
          })
          if (!response.ok) throw new Error('Could not delete the saved file.')
          setDeleting(null)
          setOffset(0)
          setRevision((v) => v + 1)
        }}
      />
    </PageShell>
  )
}
