import { useState } from 'react'
import { Button } from './Button'
import {
  fetchTeamPublications,
  publishReviewedRevision,
  type TeamPublicationsView,
} from '../lib/publications'

// BAZ-046: the operator's publication surface for one Team.
//
// The panel is deliberately blunt about three things, because each is a place where an operator could
// otherwise assume more than happened:
//
//   - A publication **never merges and never deploys**, and the panel says so next to the outcome.
//   - The commit is **unsigned**, stated rather than implied.
//   - A **refusal sent nothing**, so it reads as a reason rather than as a failure to retry blindly.

export function PublicationPanel({ teamId }: { teamId: string }) {
  const [view, setView] = useState<TeamPublicationsView | null>(null)
  const [packetId, setPacketId] = useState('')
  const [branch, setBranch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<{ reason: string; detail: string } | null>(null)

  const load = async () => {
    setBusy(true)
    const next = await fetchTeamPublications({ data: { id: teamId } })
    setBusy(false)
    setView(next)
  }

  if (view === null) {
    return (
      <section className="card space-y-3" aria-label="Publications">
        <h3>Publications</h3>
        <p className="muted">
          Publishing commits a reviewed revision to a new branch and opens a pull request. It never merges
          and never deploys, and the commit is unsigned.
        </p>
        <Button variant="ghost" disabled={busy} onClick={() => void load()}>
          Load publications
        </Button>
      </section>
    )
  }

  return (
    <section className="card space-y-3" aria-label="Publications">
      <h3>Publications</h3>
      <p className="muted">
        Publishing commits a reviewed revision to a new branch and opens a pull request. It never merges
        and never deploys, and the commit is unsigned.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col grow text-sm">
          <span className="muted">Reviewed packet id</span>
          <input value={packetId} onChange={(event) => setPacketId(event.target.value)} />
        </label>
        <label className="flex flex-col grow text-sm">
          <span className="muted">Branch (optional)</span>
          <input
            value={branch}
            placeholder="bazilion/review-…"
            onChange={(event) => setBranch(event.target.value)}
          />
        </label>
        <Button
          variant="primary"
          disabled={busy || packetId.trim().length === 0}
          onClick={() => {
            void (async () => {
              setBusy(true)
              setError(null)
              setRefusal(null)
              const result = await publishReviewedRevision({
                data: {
                  id: teamId,
                  packetId: packetId.trim(),
                  ...(branch.trim() ? { headBranch: branch.trim() } : {}),
                },
              })
              setBusy(false)
              if ('blocked' in result && result.blocked) {
                setRefusal(result.blocked)
                return
              }
              if ('unavailable' in result && result.unavailable) {
                setError(result.unavailable.message)
                return
              }
              await load()
            })()
          }}
        >
          Publish
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {refusal ? (
        <p role="alert" className="rounded-sm border border-fawn p-2 text-sm">
          Refused ({refusal.reason}): {refusal.detail} — nothing was sent.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-sm border border-fawn p-2 text-sm">
          {error}
        </p>
      ) : null}
      {view.unavailable ? <p role="alert">{view.unavailable.message}</p> : null}
      {view.publications.length === 0 ? (
        <p className="muted">No publications yet. Nothing has been sent anywhere for this Team.</p>
      ) : (
        <ul className="list">
          {view.publications.map((publication) => (
            <li key={publication.id} className="card space-y-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <strong>{publication.state}</strong>
                <span className="muted">
                  {publication.host} {publication.repository}
                </span>
              </div>
              <p className="muted">
                {publication.headBranch} (base {publication.baseBranch}) · packet {publication.packetId}
              </p>
              {publication.commitOid ? (
                <p className="muted">
                  commit {publication.commitOid.slice(0, 12)} · unsigned
                </p>
              ) : null}
              {publication.pullRequestUrl ? (
                <p className="muted">
                  pull request{' '}
                  <a href={publication.pullRequestUrl} rel="noreferrer" target="_blank">
                    #{publication.pullRequestNumber ?? ''}
                  </a>
                </p>
              ) : publication.state === 'published' ? (
                <p className="muted">no pull request was opened</p>
              ) : null}
              {publication.refusalReason ? (
                <p className="muted">
                  refused: {publication.refusalReason} — {publication.refusalDetail}
                </p>
              ) : null}
              {publication.error ? <p className="muted">note: {publication.error}</p> : null}
              <p className="muted">
                {publication.state === 'refused'
                  ? 'Nothing was sent: no commit, no push, no pull request.'
                  : publication.state === 'uncertain'
                    ? 'Whether the branch reached the host is unknown. Check the host before publishing again.'
                    : 'Nothing was merged and nothing was deployed.'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
