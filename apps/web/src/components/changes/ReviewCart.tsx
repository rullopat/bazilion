// The review being written: its comments, a note about the whole of it, who gets it, and Send.
// Everything goes to one Agent as one message, which it runs as its next turn.

import type {
  Agent,
  ReviewChangeAuthor,
  ReviewFeedbackRequest,
  ReviewFeedbackResponse,
} from '@bazilion/api-types'
import { Link } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { useState } from 'react'
import { useActivity } from '../../lib/activity'
import { ApiError, api, errorMessage } from '../../lib/api'
import { unavailableMessage } from '../../lib/git-review-presentation'
import { Button } from '../Button'
import { useWorkspace } from '../workspace/context'
import type { ReviewSessionControls } from './review'
import { splitPath } from './review'

/** The daemon takes this many comments in one review. */
const MAX_COMMENTS = 20

/** Who a review most likely is for: whoever wrote most of the commented files. */
function likelyRecipient(
  session: ReviewSessionControls,
  authors: Record<string, ReviewChangeAuthor>,
  members: Agent[],
  openAgentId: string | undefined,
): string {
  const votes = new Map<string, number>()
  for (const comment of session.comments) {
    const author = authors[comment.path]?.agentId
    if (author) votes.set(author, (votes.get(author) ?? 0) + 1)
  }
  const voted = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0]
  const isMember = (id: string | undefined) => members.some((member) => member.id === id)
  if (isMember(voted)) return voted as string
  if (isMember(openAgentId)) return openAgentId as string
  return members[0]?.id ?? ''
}

export function ReviewCart({
  teamId,
  session,
  authors,
  onOpenFile,
}: {
  teamId: string
  session: ReviewSessionControls
  authors: Record<string, ReviewChangeAuthor>
  /** Show the file a comment is about. */
  onOpenFile?: (path: string) => void
}) {
  const { agents, agent: open, to } = useWorkspace()
  const activity = useActivity()
  const members = agents.filter((agent) => agent.teamId === teamId)
  const [chosen, setChosen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState<{ agentId: string; message: string } | null>(null)
  const suggested = likelyRecipient(session, authors, members, open?.agent.id)
  const agentId = chosen && members.some((member) => member.id === chosen) ? chosen : suggested
  const count = session.comments.length

  async function send() {
    setBusy(true)
    setError('')
    try {
      const body: ReviewFeedbackRequest = {
        agentId,
        comments: session.comments.map(({ path, line, note }) => ({
          path,
          ...(line === undefined ? {} : { line }),
          ...(note ? { note } : {}),
        })),
        ...(session.note.trim() ? { note: session.note.trim() } : {}),
        ...(session.base ? { base: session.base } : {}),
      }
      const result = await api<ReviewFeedbackResponse>(
        `/api/teams/${encodeURIComponent(teamId)}/review/feedback`,
        { body },
      )
      setSent({ agentId, message: result.message })
      session.clear()
      activity.refresh()
    } catch (cause) {
      const code = cause instanceof ApiError ? cause.code : undefined
      setError(unavailableMessage(code, errorMessage(cause)))
    } finally {
      setBusy(false)
    }
  }

  if (count === 0) {
    const recipient = sent ? members.find((member) => member.id === sent.agentId) : undefined
    return sent ? (
      <div
        role="status"
        className="rounded-2xl border border-success/30 bg-success/[0.08] px-3 py-2.5 text-sm"
      >
        <p className="m-0 font-semibold text-foreground">
          Sent to {recipient?.name ?? 'the Agent'}. It runs the review as its next turn.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {recipient && (
            <Link
              to="/"
              search={to({ agent: recipient.id, view: undefined, file: undefined })}
              className="ghost-btn min-h-8 px-3 py-1 text-xs"
            >
              Open the conversation
            </Link>
          )}
          <Button
            variant="ghost"
            className="min-h-8 px-3 py-1 text-xs"
            onClick={() => setSent(null)}
          >
            Dismiss
          </Button>
        </div>
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-mocha">The message it received</summary>
          <pre className="m-0 mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-[10px] bg-card p-2.5 font-mono text-xs">
            {sent.message}
          </pre>
        </details>
      </div>
    ) : (
      <p className="m-0 rounded-2xl border border-dashed border-border bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
        No comments yet. Click a line number in a diff, or comment on a whole file. The comments go
        to one Agent together.
      </p>
    )
  }

  return (
    <div className="rounded-2xl border border-primary/25 bg-accent/25 p-3">
      <p className="m-0 text-sm font-semibold text-foreground">
        Your review · {count} comment{count === 1 ? '' : 's'}
      </p>
      <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
        {session.comments.map((comment) => {
          const { name } = splitPath(comment.path)
          return (
            <li
              key={comment.id}
              className="flex items-start gap-2 rounded-[10px] border border-border bg-card px-2.5 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => onOpenFile?.(comment.path)}
                  title={comment.path}
                  className="unstyled block max-w-full truncate font-mono text-xs font-medium text-accent-foreground hover:underline"
                >
                  {name}
                  {comment.line === undefined ? '' : `:${comment.line}`}
                </button>
                <p className="m-0 mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-xs text-chocolate">
                  {comment.note || 'No note: the Agent gets the file and its diff.'}
                </p>
              </div>
              <button
                type="button"
                aria-label="Remove this comment"
                onClick={() => session.removeComment(comment.id)}
                className="unstyled flex size-6 shrink-0 items-center justify-center rounded-md text-mocha hover:bg-muted hover:text-danger"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          )
        })}
      </ul>
      <label className="mb-0 mt-2.5 text-xs">
        About the review as a whole (optional)
        <textarea
          rows={2}
          maxLength={2000}
          value={session.note}
          onChange={(event) => session.setNote(event.target.value)}
          className="min-h-14 text-sm"
        />
      </label>
      <div className="mt-2.5 flex flex-wrap items-end gap-2">
        <label className="m-0 min-w-0 flex-1 basis-40 text-xs">
          Send to
          <select value={agentId} onChange={(event) => setChosen(event.target.value)}>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
                {member.id === suggested &&
                session.comments.some((c) => authors[c.path]?.agentId === member.id)
                  ? ' (wrote these files)'
                  : ''}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="primary"
          disabled={busy || !agentId || count > MAX_COMMENTS}
          onClick={() => void send()}
        >
          {busy ? 'Sending…' : 'Send review'}
        </Button>
      </div>
      {count > MAX_COMMENTS && (
        <p className="m-0 mt-2 text-xs text-danger">
          A review takes {MAX_COMMENTS} comments at most: remove {count - MAX_COMMENTS}.
        </p>
      )}
      {members.length === 0 && (
        <p className="m-0 mt-2 text-xs text-danger">This Team has no Agent to send a review to.</p>
      )}
      {error && (
        <p role="alert" className="m-0 mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
