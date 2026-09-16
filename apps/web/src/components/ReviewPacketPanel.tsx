import {
  type ReviewFileLink,
  type ReviewPacketReport,
  type ReviewReportedState,
  type ReviewSeverity,
} from '@bazilion/api-types'
import { useState } from 'react'
import { Button } from './Button'
import type { ReviewUnavailable, TeamReviewPacketsView } from '../lib/review-packets'
import {
  addReviewFinding,
  createReviewPacket,
  fetchReviewExport,
  fetchReviewFileLink,
  fetchReviewPacket,
  recordReportedState,
  recordReviewConclusion,
  resolveReviewFinding,
} from '../lib/review-packets'

// BAZ-043: the operator's review-packet panel.
//
// It shows the captured revision, the findings, the reviewers' conclusions and the next action, and it
// keeps the three-valued applicability visible rather than turning it into a badge: "changed" means the
// source moved, never that a finding was addressed.

const SEVERITIES: readonly ReviewSeverity[] = ['blocker', 'major', 'minor', 'info']
const CONCLUSIONS = ['changes_requested', 'commented', 'recommended'] as const
/**
 * The completion facts, in the order they happen. Each is shown with the state it actually has: a review
 * conclusion is not acceptance, and a reported state is what the operator said rather than something the
 * daemon checked.
 */
const REPORTED_STATES: readonly ReviewReportedState[] = [
  'committed',
  'pushed',
  'pullRequest',
  'merged',
  'deployed',
  'productionAccepted',
]

function applicabilityLabel(comparison: 'identical' | 'changed' | 'unknown'): string {
  return comparison === 'identical'
    ? 'unchanged since capture'
    : comparison === 'changed'
      ? 'changed since capture (never a pass)'
      : 'not checked'
}

export function ReviewPacketPanel({ teamId, view }: { teamId: string; view: TeamReviewPacketsView }) {
  const [reports, setReports] = useState<Record<string, ReviewPacketReport>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ReviewUnavailable | null>(null)
  const [snapshotId, setSnapshotId] = useState(view.snapshots[0]?.id ?? '')
  const [reviewer, setReviewer] = useState(view.members[0]?.id ?? '')
  const [finding, setFinding] = useState({ path: '', severity: 'major' as ReviewSeverity, note: '' })
  const [handoff, setHandoff] = useState<{ packetId: string; patch: string; text: string } | null>(null)
  const [link, setLink] = useState<{ packetId: string; link: ReviewFileLink } | null>(null)
  const [reference, setReference] = useState('')
  const [reportedState, setReportedState] = useState<ReviewReportedState>('committed')
  const [linkPath, setLinkPath] = useState('')

  const run = async (action: () => Promise<{ report?: ReviewPacketReport } | ReviewUnavailable>) => {
    setBusy(true)
    setError(null)
    try {
      const result = await action()
      if ('report' in result && result.report) {
        setReports((current) => ({ ...current, [result.report!.packet.id]: result.report! }))
      } else if ('message' in result) {
        setError(result)
      }
    } finally {
      setBusy(false)
    }
  }

  const create = () =>
    run(() => createReviewPacket({ data: { id: teamId, snapshotId, reviewerAgentId: reviewer || null } }))
  const load = (packetId: string) => run(() => fetchReviewPacket({ data: { id: teamId, packetId } }))
  const reportFor = (packetId: string) => reports[packetId]

  return (
    <section className="space-y-3" aria-label="Review packets">
      <div className="flex items-baseline justify-between gap-2">
        <h3>Review packets</h3>
        <span className="muted">
          A packet binds one captured revision. Findings are recorded against it; resolving one needs an
          explicit decision or a named later revision.
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-sm">
          <span className="muted">Revision</span>
          <select
            value={snapshotId}
            onChange={(event) => setSnapshotId(event.target.value)}
            className="unstyled"
          >
            {view.snapshots.length === 0 ? <option value="">(none captured)</option> : null}
            {view.snapshots.map((snapshot) => (
              <option key={snapshot.id} value={snapshot.id}>
                {snapshot.id.slice(0, 12)}
                {snapshot.complete ? '' : ' — INCOMPLETE'}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-sm">
          <span className="muted">Reviewer (optional)</span>
          <select
            value={reviewer}
            onChange={(event) => setReviewer(event.target.value)}
            className="unstyled"
          >
            <option value="">none — nothing delegated</option>
            {view.members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
        <Button variant="primary" disabled={busy || !snapshotId} onClick={create}>
          Open packet
        </Button>
      </div>

      {error ? (
        <p role="alert" className="rounded-sm border border-fawn p-2 text-sm">
          {error.message}
        </p>
      ) : null}

      {view.packets.length === 0 ? (
        <p className="muted">No review packets yet.</p>
      ) : (
        <ul className="list">
          {view.packets.map((entry) => {
            const report = reportFor(entry.packet.id)
            return (
              <li key={entry.packet.id} className="card space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <strong>{entry.packet.state}</strong>{' '}
                    <span className="muted">
                      {entry.packet.reviewerAgentId ?? 'no reviewer'} ·{' '}
                      {entry.packet.snapshot.id.slice(0, 12)}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" disabled={busy} onClick={() => load(entry.packet.id)}>
                      Details
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true)
                        const result = await fetchReviewExport({
                          data: { id: teamId, packetId: entry.packet.id },
                        })
                        setBusy(false)
                        if ('handoff' in result) {
                          setHandoff({ packetId: entry.packet.id, patch: result.patch, text: result.handoff })
                        } else if ('message' in result) setError(result)
                      }}
                    >
                      Handoff
                    </Button>
                  </div>
                </div>
                <p className="muted">
                  {entry.counts.findings} finding(s), {entry.counts.unresolved} unresolved
                  {entry.counts.blockers > 0 ? `, ${entry.counts.blockers} blocker(s)` : ''} ·{' '}
                  {entry.conclusion ?? 'no conclusion yet'}
                </p>

                {handoff?.packetId === entry.packet.id ? (
                  <div className="space-y-1">
                    <h4>Handoff</h4>
                    <pre className="overflow-x-auto rounded-sm border border-fawn p-2 text-xs">
                      {handoff.text}
                    </pre>
                    {handoff.patch ? <pre className="overflow-x-auto rounded-sm border border-fawn p-2 text-xs">{handoff.patch}</pre> : null}
                    <Button
                      variant="ghost"
                      onClick={() => {
                        void navigator.clipboard?.writeText(handoff.patch || handoff.text)
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                ) : null}

                {report ? (
                  <>
                    <p className="muted">
                      applicability: {applicabilityLabel(report.applicability.comparison)}
                    </p>
                    <ul>
                      {report.findings.map((item) => (
                        <li key={item.id}>
                          <span className="muted">[{item.severity}]</span>{' '}
                          <code>
                            {item.path}
                            {item.lineStart === null
                              ? ''
                              : `:${item.lineStart}${item.lineEnd && item.lineEnd !== item.lineStart ? `-${item.lineEnd}` : ''}`}
                          </code>{' '}
                          — {item.note}
                          {item.resolution ? (
                            <span className="muted">
                              {' '}
                              · resolved ({item.resolution.kind}) by {item.resolution.by.kind}
                            </span>
                          ) : item.state === 'unverified' ? (
                            <span className="muted"> · UNVERIFIED — not correlated to this revision</span>
                          ) : (
                            <Button
                              variant="ghost"
                              disabled={busy}
                              onClick={() =>
                                run(() =>
                                  resolveReviewFinding({
                                    data: {
                                      id: teamId,
                                      packetId: entry.packet.id,
                                      findingId: item.id,
                                      resolutionKind: 'explicit',
                                      resolutionNote: 'resolved by the operator',
                                    },
                                  }),
                                )
                              }
                            >
                              Resolve explicitly
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>

                    <div className="flex flex-wrap items-end gap-2">
                      <label className="flex flex-col text-sm">
                        <span className="muted">Finding path</span>
                        <input
                          value={finding.path}
                          onChange={(event) => setFinding({ ...finding, path: event.target.value })}
                        />
                      </label>
                      <label className="flex flex-col text-sm">
                        <span className="muted">Severity</span>
                        <select
                          value={finding.severity}
                          onChange={(event) =>
                            setFinding({ ...finding, severity: event.target.value as ReviewSeverity })
                          }
                        >
                          {SEVERITIES.map((severity) => (
                            <option key={severity} value={severity}>
                              {severity}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col grow text-sm">
                        <span className="muted">Note</span>
                        <input
                          value={finding.note}
                          onChange={(event) => setFinding({ ...finding, note: event.target.value })}
                        />
                      </label>
                      <Button
                        variant="ghost"
                        disabled={busy || !finding.path || !finding.note}
                        onClick={() =>
                          run(() =>
                            addReviewFinding({
                              data: {
                                id: teamId,
                                packetId: entry.packet.id,
                                path: finding.path,
                                severity: finding.severity,
                                note: finding.note,
                              },
                            }),
                          )
                        }
                      >
                        Add finding
                      </Button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="muted">Conclusion:</span>
                      {CONCLUSIONS.map((conclusion) => (
                        <Button
                          key={conclusion}
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            run(() =>
                              recordReviewConclusion({
                                data: { id: teamId, packetId: entry.packet.id, conclusion },
                              }),
                            )
                          }
                        >
                          {conclusion}
                        </Button>
                      ))}
                    </div>
                    <div className="space-y-1">
                      <span className="muted">
                        Where a file link points. The workspace belongs to the machine running the daemon,
                        so this says which host it names and whether it is the reviewed revision.
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          placeholder="changed path"
                          value={linkPath}
                          onChange={(event) => setLinkPath(event.target.value)}
                        />
                        <Button
                          variant="ghost"
                          disabled={busy || !linkPath}
                          onClick={async () => {
                            const result = await fetchReviewFileLink({
                              data: { id: teamId, packetId: entry.packet.id, path: linkPath },
                            })
                            if ('link' in result) setLink({ packetId: entry.packet.id, link: result.link })
                            else if ('message' in result) setError(result)
                          }}
                        >
                          Resolve location
                        </Button>
                        {link?.packetId === entry.packet.id ? (
                          <Button
                            variant="ghost"
                            onClick={() => void navigator.clipboard?.writeText(link.link.copyTarget)}
                          >
                            Copy location
                          </Button>
                        ) : null}
                      </div>
                      {link?.packetId === entry.packet.id ? (
                        <p className="muted">
                          <code>{link.link.copyTarget}</code> · on{' '}
                          {link.link.host.daemon ?? 'the daemon host'} ·{' '}
                          {link.link.mode === 'live'
                            ? 'the reviewed revision'
                            : link.link.mode === 'stale'
                              ? 'the CURRENT file, not the reviewed revision'
                              : 'unknown'}{' '}
                          ·{' '}
                          {link.link.canOpen
                            ? `an editor is configured on the daemon host (${link.link.command})`
                            : 'no editor configured, so nothing can be opened here'}
                        </p>
                      ) : null}
                    </div>

                    <p className="muted">
                      completed: change prepared={String(report.facts.changePrepared)} checks current=
                      {String(report.facts.checksCurrent)} reviewed={String(report.facts.reviewed)} — a
                      conclusion is not acceptance, and nothing here commits, pushes, merges or deploys.
                    </p>

                    <div className="space-y-1">
                      <span className="muted">
                        Beyond this point nothing is verified: Bazilion has no code-host integration, so these
                        are whatever you report.
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          className="unstyled"
                          value={reportedState}
                          onChange={(event) =>
                            setReportedState(event.target.value as ReviewReportedState)
                          }
                        >
                          {REPORTED_STATES.map((state) => (
                            <option key={state} value={state}>
                              {state}
                            </option>
                          ))}
                        </select>
                        <input
                          placeholder="commit id, URL, release name…"
                          value={reference}
                          onChange={(event) => setReference(event.target.value)}
                        />
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            run(() =>
                              recordReportedState({
                                data: {
                                  id: teamId,
                                  packetId: entry.packet.id,
                                  state: reportedState,
                                  reference: reference || null,
                                },
                              }),
                            )
                          }
                        >
                          Report
                        </Button>
                      </div>
                      <p className="muted">
                        reported (reported, not verified):{' '}
                        {Object.entries(report.packet.reported)
                          .filter(([, value]) => value !== null)
                          .map(([key, value]) => `${key}=${value}`)
                          .join(' ') || 'nothing yet'}
                      </p>
                    </div>
                  </>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
