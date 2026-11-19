// The Changes tab: what the Team's workspace has changed since a commit, one file's diff, and
// the review being written. Read-only: nothing here stages, commits or reverts.

import type { Team } from '@bazilion/api-types'
import { Link, useRouter } from '@tanstack/react-router'
import { Columns2, MessageSquarePlus } from 'lucide-react'
import { useState } from 'react'
import { unavailableMessage } from '../../lib/git-review-presentation'
import { Button } from '../Button'
import { BaseBar } from '../changes/BaseBar'
import { UnifiedDiff } from '../changes/DiffView'
import { FileList } from '../changes/FileList'
import { ReviewCart } from '../changes/ReviewCart'
import { splitPath, useFileDiff, useReviewList, useReviewSession } from '../changes/review'
import { useWorkspace } from '../workspace/context'
import { PanelHeading } from './SidePanel'

export function ChangesPanel({ team }: { team: Team }) {
  const { search, to } = useWorkspace()
  const router = useRouter()
  const session = useReviewSession(team.id)
  const list = useReviewList(team.id, session.base)
  const changes = list.data?.review?.changes ?? null
  const authors = list.data?.review?.authors ?? {}
  const selected = changes?.changes.find((change) => change.path === search.file)?.path ?? null
  const diff = useFileDiff(team.id, session.base, selected, list.data)
  const select = (path: string | undefined) =>
    void router.navigate({ to: '/', search: to({ file: path }), replace: true })

  return (
    <div>
      <BaseBar
        changes={changes}
        base={session.base}
        loading={list.loading}
        onBase={session.setBase}
        onRefresh={() => void list.reload()}
      />

      {list.error && (
        <p role="alert" className="err mt-3">
          {list.error}
        </p>
      )}
      {list.data?.unavailable && (
        <p
          role="alert"
          className="m-0 mt-3 rounded-2xl border border-border bg-muted/50 px-3 py-3 text-sm"
        >
          {unavailableMessage(list.data.unavailable.code, list.data.unavailable.message)}
        </p>
      )}
      {!list.data && !list.error && (
        <p role="status" className="m-0 mt-3 text-sm text-muted-foreground">
          Loading the changes…
        </p>
      )}

      {changes && (
        <>
          <div className="mt-3 flex items-center justify-between gap-2">
            <PanelHeading>
              {changes.changes.length} changed file{changes.changes.length === 1 ? '' : 's'}
            </PanelHeading>
            {changes.changes.length > 0 && (
              <Link
                to="/"
                search={to({ view: 'changes', file: selected ?? changes.changes[0]?.path })}
                className="inline-flex h-7 items-center gap-1 rounded-[10px] border border-border bg-card px-2 text-xs font-semibold text-foreground hover:border-sapphire-light hover:text-sapphire"
              >
                <Columns2 className="size-3.5" aria-hidden="true" />
                Side by side
              </Link>
            )}
          </div>
          <FileList
            changes={changes}
            authors={authors}
            comments={session.comments}
            selected={selected}
            onSelect={(path) => select(path === selected ? undefined : path)}
          />
        </>
      )}

      {selected && (
        <section aria-label={`Diff of ${selected}`} className="mt-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3
              className="m-0 min-w-0 flex-1 truncate font-mono text-xs font-medium text-foreground"
              title={selected}
            >
              {splitPath(selected).name}
            </h3>
            <FileComment onAdd={(note) => session.addComment({ path: selected, note })} />
          </div>
          <div className="mt-2 max-h-[55vh] overflow-auto rounded-2xl border border-border bg-card">
            {diff.error ? (
              <p role="alert" className="m-0 p-3 text-sm text-danger">
                {diff.error}
              </p>
            ) : !diff.data ? (
              <p role="status" className="m-0 p-3 text-sm text-muted-foreground">
                Loading the diff…
              </p>
            ) : diff.data.patch === null ? (
              <p className="m-0 p-3 text-sm text-muted-foreground">
                No diff text for this file
                {diff.data.omitted ? ` (${diff.data.omitted.replaceAll('_', ' ')})` : ''}.
              </p>
            ) : (
              <UnifiedDiff
                patch={diff.data.patch}
                comments={session.comments.filter((comment) => comment.path === selected)}
                onAddComment={(line, note) => session.addComment({ path: selected, line, note })}
                onRemoveComment={session.removeComment}
              />
            )}
          </div>
          {diff.data?.truncated && (
            <p className="m-0 mt-1.5 text-xs text-warning">
              This diff was cut: the file changed more.
            </p>
          )}
        </section>
      )}

      {changes && changes.changes.length > 0 && (
        <div className="mt-4">
          <ReviewCart
            teamId={team.id}
            session={session}
            authors={authors}
            onOpenFile={(path) => select(path)}
          />
        </div>
      )}
    </div>
  )
}

/** A comment about a whole file, with or without a note. */
export function FileComment({ onAdd }: { onAdd: (note: string) => void }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="unstyled inline-flex h-7 shrink-0 items-center gap-1 rounded-[10px] border border-border bg-card px-2 text-xs font-semibold text-foreground hover:border-sapphire-light hover:text-sapphire"
      >
        <MessageSquarePlus className="size-3.5" aria-hidden="true" />
        Comment on the file
      </button>
    )
  }
  const add = () => {
    onAdd(note.trim())
    setNote('')
    setOpen(false)
  }
  return (
    <div className="basis-full rounded-[10px] border border-primary/30 bg-accent/40 p-2.5">
      <textarea
        // biome-ignore lint/a11y/noAutofocus: opened by the click on the button.
        autoFocus
        aria-label="Comment on the file"
        placeholder="What should change in this file? (optional: the Agent gets the diff either way)"
        rows={2}
        maxLength={2000}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false)
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) add()
        }}
        className="min-h-16 text-sm"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="primary" className="min-h-8 px-3 py-1 text-xs" onClick={add}>
          Add to the review
        </Button>
        <Button
          variant="ghost"
          className="min-h-8 px-3 py-1 text-xs"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}
