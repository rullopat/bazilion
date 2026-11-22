import type { RepositoryChanges, ReviewChange, ReviewChangeAuthor } from '@bazilion/api-types'
import { MessageSquare } from 'lucide-react'
import { changeSummary } from '../../lib/git-review-presentation'
import { AgentAvatar } from '../AgentAvatar'
import { useWorkspace } from '../workspace/context'
import { type ReviewComment, StatusMark, splitPath } from './review'

function counts(change: ReviewChange) {
  if (change.excludedReason) return <span className="text-xs text-mocha">withheld</span>
  if (change.binary) return <span className="text-xs text-mocha">binary</span>
  return (
    <span className="flex shrink-0 gap-1.5 font-mono text-xs font-medium">
      {change.addedLines ? <span className="text-success">+{change.addedLines}</span> : null}
      {change.deletedLines ? <span className="text-danger">−{change.deletedLines}</span> : null}
    </span>
  )
}

/** The changed files since the base: what changed, by how much, and which Agent wrote it. */
export function FileList({
  changes,
  authors,
  comments,
  selected,
  onSelect,
}: {
  changes: RepositoryChanges
  authors: Record<string, ReviewChangeAuthor>
  comments: readonly ReviewComment[]
  selected: string | null
  onSelect: (path: string) => void
}) {
  const { agentById } = useWorkspace()
  if (changes.changes.length === 0) {
    return (
      <p className="m-0 rounded-2xl border border-dashed border-border bg-muted/40 px-3 py-4 text-sm text-muted-foreground">
        Nothing changed since this base.
      </p>
    )
  }
  return (
    <>
      <ul className="m-0 list-none divide-y divide-frost/70 overflow-hidden rounded-2xl border border-border p-0">
        {changes.changes.map((change) => {
          const { dir, name } = splitPath(change.path)
          const author = authors[change.path]
          const commented = comments.filter((comment) => comment.path === change.path).length
          const current = change.path === selected
          return (
            <li key={`${change.status}:${change.path}`}>
              <button
                type="button"
                aria-current={current ? 'true' : undefined}
                onClick={() => onSelect(change.path)}
                title={`${change.previousPath ? `${change.previousPath} → ` : ''}${change.path} · ${changeSummary(change)}`}
                className={`unstyled flex min-h-10 w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-accent/50 ${
                  current ? 'bg-accent/60' : ''
                }`}
              >
                <StatusMark status={change.status} />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  <span className="text-mocha-light">{dir}</span>
                  <span className="font-medium text-foreground">{name}</span>
                </span>
                {commented > 0 && (
                  <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-accent-foreground">
                    <MessageSquare className="size-3" aria-hidden="true" />
                    {commented}
                  </span>
                )}
                {counts(change)}
                {author && (
                  <span title={`Last written by ${author.agentName}`} className="shrink-0">
                    <AgentAvatar identity={agentById(author.agentId)?.identity} size={18} />
                    <span className="sr-only">Last written by {author.agentName}</span>
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
      {changes.truncated && (
        <p className="m-0 mt-2 text-xs text-warning">
          This list is incomplete: more files changed than a review shows.
        </p>
      )}
      {(changes.withheld.excluded > 0 || changes.withheld.untracked > 0) && (
        <p className="m-0 mt-2 text-xs text-muted-foreground">
          Not shown: {changes.withheld.excluded} excluded and {changes.withheld.untracked} untracked
          path{changes.withheld.excluded + changes.withheld.untracked === 1 ? '' : 's'}.
        </p>
      )}
      {changes.issues.map((issue) => (
        <p
          key={`${issue.code}:${issue.message}`}
          className="m-0 mt-2 text-xs text-muted-foreground"
        >
          {issue.message}
        </p>
      ))}
    </>
  )
}
