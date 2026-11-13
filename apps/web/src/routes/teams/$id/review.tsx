// The Team workspace's Git changes since a baseline: the file list, one file's diff on request,
// and feedback about a file queued for an Agent. It never stages, commits or checks anything out.

import type { Agent, RepositoryReviewResponse, ReviewFeedbackResponse } from '@bazilion/api-types'
import { ApiClientError } from '@bazilion/client'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { Button } from '../../../components/Button'
import { ApiError, api, errorMessage } from '../../../lib/api'
import { daemonClient } from '../../../lib/daemon-client'
import { baseLabel, changeSummary, unavailableMessage } from '../../../lib/git-review-presentation'

interface Unavailable {
  code: string | undefined
  message: string
}

interface FileDiff {
  path: string
  patch: string | null
  truncated: boolean
  omitted: string | null
}

function reviewPath(teamId: string, params: Record<string, string> = {}): string {
  const query = new URLSearchParams(params).toString()
  return `/api/teams/${encodeURIComponent(teamId)}/review${query ? `?${query}` : ''}`
}

const fetchReview = createServerFn({ method: 'GET' })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const client = daemonClient()
    const agents = await client.get<Agent[]>('/api/agents')
    const members = agents
      .filter((agent) => agent.teamId === data.id)
      .map((agent) => ({ id: agent.id, name: agent.name }))
    try {
      const review = await client.get<RepositoryReviewResponse>(reviewPath(data.id))
      return { review, unavailable: null, members }
    } catch (error) {
      if (!(error instanceof ApiClientError)) throw error
      const body = error.body as { error?: string; code?: string }
      const unavailable: Unavailable = {
        code: body.code,
        message: body.error ?? 'This Team cannot be reviewed right now.',
      }
      return { review: null, unavailable, members }
    }
  })

export const Route = createFileRoute('/teams/$id/review')({
  loader: ({ params }) => fetchReview({ data: { id: params.id } }),
  component: ReviewPage,
})

function ReviewPage() {
  const loaded = Route.useLoaderData()
  const { id: teamId } = Route.useParams()
  const [base, setBase] = useState('')
  const [appliedBase, setAppliedBase] = useState('')
  const [review, setReview] = useState(loaded.review)
  const [unavailable, setUnavailable] = useState<Unavailable | null>(loaded.unavailable)
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [note, setNote] = useState('')
  const [agentId, setAgentId] = useState(loaded.members[0]?.id ?? '')
  const [queuedMessage, setQueuedMessage] = useState<string | null>(null)
  const [status, setStatus] = useState<{ error: boolean; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const baseParam = (value: string): Record<string, string> => (value ? { base: value } : {})

  async function load(nextBase = appliedBase) {
    setBusy(true)
    setStatus({ error: false, message: 'Loading changes…' })
    try {
      setReview(await api<RepositoryReviewResponse>(reviewPath(teamId, baseParam(nextBase))))
      setUnavailable(null)
    } catch (cause) {
      setReview(null)
      setUnavailable({
        code: cause instanceof ApiError ? cause.code : undefined,
        message: errorMessage(cause),
      })
    } finally {
      setAppliedBase(nextBase)
      setSelected(null)
      setDiff(null)
      setStatus(null)
      setBusy(false)
    }
  }

  async function openDiff(path: string) {
    setSelected(path)
    setDiff(null)
    setQueuedMessage(null)
    try {
      const response = await api<RepositoryReviewResponse>(
        reviewPath(teamId, { patches: '1', path, ...baseParam(appliedBase) }),
      )
      const change = response.changes.changes.find((entry) => entry.path === path)
      setDiff({
        path,
        patch: change?.patch ?? null,
        truncated: change?.patchTruncated ?? false,
        omitted: change?.contentOmitted ?? null,
      })
    } catch (cause) {
      setStatus({ error: true, message: errorMessage(cause) })
    }
  }

  async function send() {
    if (!selected || !agentId) return
    setBusy(true)
    setStatus({ error: false, message: 'Queueing feedback…' })
    try {
      const result = await api<ReviewFeedbackResponse>(
        `/api/teams/${encodeURIComponent(teamId)}/review/feedback`,
        {
          body: {
            path: selected,
            agentId,
            ...(note.trim() ? { note } : {}),
            ...baseParam(appliedBase),
          },
        },
      )
      setQueuedMessage(result.message)
      setNote('')
      setStatus({ error: false, message: 'Feedback queued; the Agent runs it as its next turn.' })
    } catch (cause) {
      const code = cause instanceof ApiError ? cause.code : undefined
      setStatus({ error: true, message: unavailableMessage(code, errorMessage(cause)) })
    } finally {
      setBusy(false)
    }
  }

  const changes = review?.changes

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Changes since a baseline commit, read-only: nothing here stages, commits or reverts
        anything.
      </p>

      <section className="space-y-2" aria-label="Comparison base">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="m-0 min-w-0 flex-1">
            Comparison base
            <input
              value={base}
              placeholder="HEAD, main, HEAD~1…"
              onChange={(event) => setBase(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void load(base)
              }}
            />
          </label>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => void load(base)}>
              Apply base
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void load()}>
              Refresh
            </Button>
          </div>
        </div>
        {changes && <p className="text-sm opacity-80">{baseLabel(changes.identity, changes)}</p>}
        <p className="text-xs opacity-70">
          A branch name resolves to a commit when the review loads, so a moving branch cannot change
          what you are looking at.
        </p>
      </section>

      {status && (
        <p role={status.error ? 'alert' : 'status'} className="text-sm">
          {status.message}
        </p>
      )}

      {unavailable && (
        <section
          className="rounded-sm border border-fawn bg-ivory p-3"
          aria-label="Review unavailable"
        >
          <p role="alert">{unavailableMessage(unavailable.code, unavailable.message)}</p>
        </section>
      )}

      {changes && (
        <section className="space-y-2" aria-label="Changes since baseline">
          <h2>Changes since baseline</h2>
          {changes.changes.length === 0 ? (
            <p>No changes since this baseline.</p>
          ) : (
            <ul className="divide-y divide-fawn rounded-sm border border-fawn">
              {changes.changes.map((change) => (
                <li key={`${change.status}:${change.path}`}>
                  <button
                    type="button"
                    aria-current={selected === change.path ? 'true' : undefined}
                    onClick={() => void openDiff(change.path)}
                    className="flex w-full flex-col gap-1 px-3 py-2 text-left hover:bg-sapphire-glow focus:bg-sapphire-glow"
                  >
                    <span className="break-all font-mono text-sm">
                      {change.previousPath
                        ? `${change.previousPath} → ${change.path}`
                        : change.path}
                    </span>
                    <span className="text-xs opacity-80">
                      {changeSummary(change)}
                      {change.patchTruncated ? ' · diff truncated' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {changes.truncated && (
            <p className="text-sm">
              This list is incomplete: more files changed than the review shows.
            </p>
          )}
          {(changes.withheld.excluded > 0 || changes.withheld.untracked > 0) && (
            <p className="text-xs opacity-80">
              {changes.withheld.excluded} excluded and {changes.withheld.untracked} untracked
              path(s) are not shown.
            </p>
          )}
          {changes.issues.map((issue) => (
            <p key={`${issue.code}:${issue.message}`} className="text-xs opacity-80">
              note: {issue.code}: {issue.message}
            </p>
          ))}
        </section>
      )}

      {selected && (
        <section className="space-y-2" aria-label="Selected file diff">
          <h2 className="break-all font-mono text-base">{selected}</h2>
          {diff === null ? (
            <p className="text-sm">Loading…</p>
          ) : diff.patch === null ? (
            <p className="text-sm">
              No diff text for this file
              {diff.omitted ? ` (${diff.omitted.replaceAll('_', ' ')})` : ''}.
            </p>
          ) : (
            <>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-[rgba(42,31,22,0.04)] p-3 font-mono text-xs">
                {diff.patch}
              </pre>
              {diff.truncated && <p className="text-xs">This diff was truncated.</p>}
            </>
          )}

          <div className="space-y-2 rounded-sm border border-fawn p-3">
            <h3>Send feedback about this file</h3>
            <label>
              Note (optional)
              <textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
            <label>
              Agent
              <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                {loaded.members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="primary" disabled={busy || !agentId} onClick={() => void send()}>
              Queue for Agent
            </Button>
            <p className="text-xs opacity-70">
              The Agent gets the file, its change, a diff excerpt and your note as its next turn.
            </p>
            {queuedMessage && (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-[rgba(42,31,22,0.04)] p-3 font-mono text-xs">
                {queuedMessage}
              </pre>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
