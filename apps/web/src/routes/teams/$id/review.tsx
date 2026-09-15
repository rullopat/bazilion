// Per-Team Git change review (BAZ-042). Read-only: this panel lists changes since an explicit
// baseline, shows one file's diff on request, and captures bounded source snapshots. It never
// stages, commits or checks anything out, and a snapshot stores paths and digests — not content.

import type { SourceSnapshot } from '@bazilion/api-types'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '../../../components/Button'
import { PageShell } from '../../../components/Page'
import { TeamTabs } from '../../../components/TeamTabs'
import {
  baseLabel,
  changeSummary,
  changeStatusLabel,
  referenceLabel,
  snapshotLabel,
  unavailableMessage,
} from '../../../lib/git-review-presentation'
import {
  captureTeamSnapshot,
  fetchFileDiff,
  fetchTeamReview,
  fetchTeamSnapshot,
  type FileDiffView,
} from '../../../lib/git-review'

export const Route = createFileRoute('/teams/$id/review')({
  loader: async ({ params }) => {
    const data = await fetchTeamReview({ data: { id: params.id } })
    if (!data) throw redirect({ to: '/teams' })
    return data
  },
  component: ReviewPage,
})

function ReviewPage() {
  const loaded = Route.useLoaderData()
  const teamId = loaded.team.id
  const [base, setBase] = useState('')
  const [appliedBase, setAppliedBase] = useState('')
  const [review, setReview] = useState(loaded.review)
  const [unavailable, setUnavailable] = useState(loaded.unavailable)
  const [snapshots, setSnapshots] = useState(loaded.snapshots)
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState<FileDiffView | null>(null)
  const [snapshot, setSnapshot] = useState<SourceSnapshot | null>(null)
  const [status, setStatus] = useState<{ kind: 'info' | 'error'; message: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function load(nextBase = appliedBase) {
    setBusy(true)
    setStatus({ kind: 'info', message: 'Loading changes…' })
    try {
      const data = await fetchTeamReview({ data: { id: teamId, ...(nextBase ? { base: nextBase } : {}) } })
      if (!data) return
      setReview(data.review)
      setUnavailable(data.unavailable)
      setSnapshots(data.snapshots)
      setAppliedBase(nextBase)
      setSelected(null)
      setDiff(null)
      setStatus(null)
    } finally {
      setBusy(false)
    }
  }

  async function openDiff(path: string) {
    setSelected(path)
    setDiff(null)
    setStatus({ kind: 'info', message: 'Loading diff…' })
    const loadedDiff = await fetchFileDiff({
      data: { id: teamId, path, ...(appliedBase ? { base: appliedBase } : {}) },
    })
    setDiff(loadedDiff)
    setStatus(null)
  }

  async function capture() {
    setBusy(true)
    setStatus({ kind: 'info', message: 'Capturing a source snapshot…' })
    const result = await captureTeamSnapshot({ data: { id: teamId } })
    if ('reference' in result) {
      setStatus({ kind: 'info', message: `Captured ${referenceLabel(result.reference)}` })
      await load()
    } else {
      setStatus({ kind: 'error', message: unavailableMessage(result.code, result.message) })
    }
    setBusy(false)
  }

  async function openSnapshot(snapshotId: string) {
    setStatus({ kind: 'info', message: 'Loading snapshot…' })
    const loadedSnapshot = await fetchTeamSnapshot({ data: { id: teamId, snapshotId } })
    setSnapshot(loadedSnapshot)
    setStatus(loadedSnapshot ? null : { kind: 'error', message: 'That snapshot is no longer retained.' })
  }

  const changes = review?.changes

  return (
    <PageShell>
      <header>
        <h1>{loaded.team.name || loaded.team.id} review</h1>
        <p>
          Changes since a pinned baseline, and the source snapshots taken for them. Inspection is
          read-only — nothing here stages, commits or reverts anything.
        </p>
      </header>
      <TeamTabs teamId={teamId} />

      <section className="space-y-2" aria-label="Comparison base">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span>Comparison base</span>
            <input
              className="input"
              value={base}
              placeholder="HEAD"
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
          A branch name is resolved to a concrete commit when the review loads, so a moving tip cannot
          rewrite what you are looking at.
        </p>
      </section>

      {status && (
        <p role={status.kind === 'error' ? 'alert' : 'status'} className="text-sm">
          {status.message}
        </p>
      )}

      {unavailable && (
        <section className="rounded-sm border border-fawn bg-ivory p-3" aria-label="Review unavailable">
          <p role="alert">{unavailableMessage(unavailable.code, unavailable.message)}</p>
          {unavailable.code && <p className="text-xs opacity-70">code: {unavailable.code}</p>}
        </section>
      )}

      {changes && (
        <section className="space-y-2" aria-label="Changes since baseline">
          <h2>Changes since baseline</h2>
          {changes.changes.length === 0 && <p>No changes since this baseline.</p>}
          {changes.changes.length > 0 && (
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
                      {change.previousPath ? `${change.previousPath} → ${change.path}` : change.path}
                    </span>
                    <span className="text-xs opacity-80">
                      {changeStatusLabel(change.status)}
                      {' · '}
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
              This list is incomplete: more files changed than the review limit allows.
            </p>
          )}
          {(changes.withheld.excluded > 0 || changes.withheld.untracked > 0) && (
            <p className="text-xs opacity-80">
              {changes.withheld.excluded} excluded and {changes.withheld.untracked} untracked path(s)
              withheld by scope policy.
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
              {diff.truncated && <p className="text-xs">This diff was truncated at the patch limit.</p>}
            </>
          )}
        </section>
      )}

      <section className="space-y-2" aria-label="Source snapshots">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2>Source snapshots</h2>
          <Button variant="ghost" disabled={busy} onClick={() => void capture()}>
            Capture snapshot
          </Button>
        </div>
        <p className="text-xs opacity-70">
          A snapshot records HEAD, the index and digests of changed files — never file content.
          Untracked content is only included when a path is named explicitly.
        </p>
        {snapshots.length === 0 && <p>No retained snapshots for this Team.</p>}
        {snapshots.length > 0 && (
          <ul className="divide-y divide-fawn rounded-sm border border-fawn">
            {snapshots.map((entry) => (
              <li key={entry.snapshotId}>
                <button
                  type="button"
                  onClick={() => void openSnapshot(entry.snapshotId)}
                  className="w-full px-3 py-2 text-left font-mono text-xs hover:bg-sapphire-glow focus:bg-sapphire-glow"
                >
                  {snapshotLabel(entry)}
                </button>
              </li>
            ))}
          </ul>
        )}
        {snapshot && (
          <div className="space-y-1">
            <p className="text-sm">
              {snapshot.id.slice(0, 12)} · {snapshot.complete ? 'complete' : 'incomplete — applicability unknown'} ·
              head {snapshot.head?.slice(0, 12) ?? '(unborn)'}
            </p>
            {snapshot.entries.length > 0 && (
              <ul className="space-y-1 font-mono text-xs">
                {snapshot.entries.map((entry) => (
                  <li key={`${entry.layer}:${entry.path}`}>
                    {entry.layer} · {entry.kind} · {entry.path}
                    {entry.bytes === null ? '' : ` · ${entry.bytes}B`}
                  </li>
                ))}
              </ul>
            )}
            {snapshot.exclusions.length > 0 && (
              <p className="text-xs opacity-80">
                withheld: {snapshot.exclusions.map((item) => `${item.path} (${item.reason})`).join(', ')}
              </p>
            )}
          </div>
        )}
      </section>
    </PageShell>
  )
}
