import type { RepositoryChanges } from '@bazilion/api-types'
import { GitBranch, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../Button'

const short = (oid: string | null) => (oid ? oid.slice(0, 7) : 'no commit')

/** Where the changes are measured from: the branch, the base commit, and a way to change it. */
export function BaseBar({
  changes,
  base,
  loading,
  onBase,
  onRefresh,
}: {
  changes: RepositoryChanges | null
  base: string
  loading: boolean
  onBase: (base: string) => void
  onRefresh: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(base)
  const identity = changes?.identity
  const head = identity
    ? identity.headState === 'detached'
      ? `detached at ${short(identity.head)}`
      : (identity.branch ?? 'unknown branch')
    : ''

  if (editing) {
    return (
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          onBase(draft.trim())
          setEditing(false)
        }}
      >
        <input
          // biome-ignore lint/a11y/noAutofocus: opened by the click on "since".
          autoFocus
          aria-label="Comparison base"
          placeholder="HEAD, main, HEAD~1, a commit…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="min-h-9 min-w-0 flex-1 basis-40 py-1.5 font-mono text-xs"
        />
        <Button variant="primary" type="submit" className="min-h-9 px-3 py-1 text-xs">
          Compare
        </Button>
        <Button
          variant="ghost"
          className="min-h-9 px-3 py-1 text-xs"
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
        <p className="m-0 basis-full text-xs text-muted-foreground">
          A branch name is pinned to its commit when the review loads. Empty means HEAD: what is not
          committed yet.
        </p>
      </form>
    )
  }

  return (
    <div className="flex min-w-0 items-center gap-2 text-xs">
      <GitBranch className="size-3.5 shrink-0 text-mocha" aria-hidden="true" />
      <span className="min-w-0 truncate font-mono text-foreground" title={head}>
        {head || '…'}
      </span>
      <button
        type="button"
        onClick={() => {
          setDraft(base)
          setEditing(true)
        }}
        title="Change the comparison base"
        className="unstyled shrink-0 rounded-full border border-border bg-card px-2 py-0.5 font-mono text-mocha hover:border-sapphire-light hover:text-sapphire"
      >
        since {changes ? changes.base.requestedRef : base || 'HEAD'}
        {changes ? ` (${short(changes.base.resolvedOid)})` : ''}
      </button>
      <button
        type="button"
        onClick={onRefresh}
        aria-label="Refresh the changes"
        title="Refresh"
        className="unstyled ml-auto flex size-7 shrink-0 items-center justify-center rounded-lg text-mocha hover:bg-muted hover:text-sapphire"
      >
        <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
      </button>
    </div>
  )
}
