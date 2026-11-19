// The Changes view: the changed files on the left, the selected file's diff with the old and the
// new file side by side, and the review being written. Read-only: nothing here stages, commits
// or reverts.

import type { Team } from '@bazilion/api-types'
import { Link, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { shortTime } from '../../lib/activity'
import { changeSummary, unavailableMessage } from '../../lib/git-review-presentation'
import { useHydrated, useMediaQuery } from '../../lib/use-resource'
import { AgentAvatar } from '../AgentAvatar'
import { FileComment } from '../panel/ChangesPanel'
import { Segmented } from '../Segmented'
import { useWorkspace } from '../workspace/context'
import { FocusFrame } from '../workspace/FocusFrame'
import { BaseBar } from './BaseBar'
import { SplitDiff, UnifiedDiff } from './DiffView'
import { FileList } from './FileList'
import { ReviewCart } from './ReviewCart'
import { StatusMark, useFileDiff, useReviewList, useReviewSession } from './review'

type Layout = 'split' | 'unified'
const LAYOUT_KEY = 'bz_diff_layout'

export function ChangesView({ team }: { team: Team }) {
  const { search, to, agentById } = useWorkspace()
  const router = useRouter()
  const hydrated = useHydrated()
  const session = useReviewSession(team.id)
  const list = useReviewList(team.id, session.base)
  const changes = list.data?.review?.changes ?? null
  const authors = list.data?.review?.authors ?? {}
  // Without a file in the address the first changed file opens.
  const change =
    changes?.changes.find((entry) => entry.path === search.file) ?? changes?.changes[0] ?? null
  const selected = change?.path ?? null
  const diff = useFileDiff(team.id, session.base, selected, list.data)
  const author = selected ? authors[selected] : undefined
  const [layout, setLayout] = useState<Layout>('split')

  // The layout last used is remembered in this browser.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(LAYOUT_KEY) === 'unified') setLayout('unified')
    } catch {
      // Storage is unavailable: side by side it is.
    }
  }, [])
  const choose = (next: Layout) => {
    setLayout(next)
    try {
      window.localStorage.setItem(LAYOUT_KEY, next)
    } catch {
      // Storage is unavailable: the choice lasts for this page.
    }
  }
  const select = (path: string) =>
    void router.navigate({ to: '/', search: to({ file: path }), replace: true })
  // Two columns of code need room: a narrow screen always gets one.
  const roomy = useMediaQuery('(min-width: 768px)')
  const Diff = layout === 'split' && roomy ? SplitDiff : UnifiedDiff

  return (
    <FocusFrame
      view="changes"
      actions={
        roomy && (
          <Segmented
            label="Diff layout"
            value={layout}
            options={[
              { id: 'split', label: 'Side by side' },
              { id: 'unified', label: 'One column' },
            ]}
            onChange={choose}
          />
        )
      }
    >
      <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[21rem_minmax(0,1fr)]">
        <div className="min-h-0 space-y-3 overflow-y-auto border-border p-3 max-lg:max-h-[42vh] max-lg:border-b lg:border-r">
          <BaseBar
            changes={changes}
            base={session.base}
            loading={list.loading}
            onBase={session.setBase}
            onRefresh={() => void list.reload()}
          />
          {list.error && (
            <p role="alert" className="err">
              {list.error}
            </p>
          )}
          {list.data?.unavailable && (
            <p
              role="alert"
              className="m-0 rounded-2xl border border-border bg-muted/50 px-3 py-3 text-sm"
            >
              {unavailableMessage(list.data.unavailable.code, list.data.unavailable.message)}
            </p>
          )}
          {!list.data && !list.error && (
            <p role="status" className="m-0 text-sm text-muted-foreground">
              Loading the changes…
            </p>
          )}
          {changes && (
            <>
              <FileList
                changes={changes}
                authors={authors}
                comments={session.comments}
                selected={selected}
                onSelect={select}
              />
              {changes.changes.length > 0 && (
                <ReviewCart
                  teamId={team.id}
                  session={session}
                  authors={authors}
                  onOpenFile={select}
                />
              )}
            </>
          )}
        </div>

        <div className="flex min-h-0 min-w-0 flex-col">
          {change && selected ? (
            <>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3 py-2">
                <StatusMark status={change.status} />
                <h2 className="m-0 min-w-0 flex-1 basis-48 break-all font-mono text-[0.82rem] font-medium leading-snug text-foreground">
                  {change.previousPath ? `${change.previousPath} → ` : ''}
                  {change.path}
                </h2>
                <span className="shrink-0 text-xs text-mocha">{changeSummary(change)}</span>
                {author && (
                  <Link
                    to="/"
                    search={{
                      agent: author.agentId,
                      conversation: author.conversationId,
                      panel: 'changes',
                      file: selected,
                    }}
                    title="Open the conversation this was written in"
                    className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted px-2 text-xs font-semibold text-mocha hover:border-sapphire-light hover:text-sapphire"
                  >
                    <AgentAvatar identity={agentById(author.agentId)?.identity} size={16} />
                    {author.agentName}
                    {hydrated && (
                      <span className="font-normal text-muted-foreground">
                        {shortTime(author.at)}
                      </span>
                    )}
                  </Link>
                )}
                <FileComment onAdd={(note) => session.addComment({ path: selected, note })} />
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {diff.error ? (
                  <p role="alert" className="m-0 p-4 text-sm text-danger">
                    {diff.error}
                  </p>
                ) : !diff.data ? (
                  <p role="status" className="m-0 p-4 text-sm text-muted-foreground">
                    Loading the diff…
                  </p>
                ) : diff.data.patch === null ? (
                  <p className="m-0 p-4 text-sm text-muted-foreground">
                    No diff text for this file
                    {diff.data.omitted ? ` (${diff.data.omitted.replaceAll('_', ' ')})` : ''}. A
                    comment on the file still reaches the Agent.
                  </p>
                ) : (
                  <Diff
                    patch={diff.data.patch}
                    comments={session.comments.filter((comment) => comment.path === selected)}
                    onAddComment={(line, note) =>
                      session.addComment({ path: selected, line, note })
                    }
                    onRemoveComment={session.removeComment}
                  />
                )}
                {diff.data?.truncated && (
                  <p className="m-0 border-t border-border px-4 py-2 text-xs text-warning">
                    This diff was cut: the file changed more than a review shows.
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="flex min-h-40 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
              {changes
                ? 'Nothing changed since this base.'
                : list.data?.unavailable
                  ? 'There is nothing to compare.'
                  : ''}
            </div>
          )}
        </div>
      </div>
    </FocusFrame>
  )
}
