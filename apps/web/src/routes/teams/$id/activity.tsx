import type { CommunicationComponentOutcome, CommunicationPolicyRef } from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../../components/Button'
import { TeamTabs } from '../../../components/TeamTabs'
import { RecoveryState } from '../../../components/RecoveryState'
import { daemonClient } from '../../../lib/daemon-client'

interface BlockEvent {
  id: string
  attempt_kind: string
  attempt_id: string
  operation: string
  source_kind: string
  source_id: string | null
  target_kind: string
  target_id: string | null
  source_team_id: string | null
  target_team_id: string | null
  channel: string
  origin: string
  reason_code: string
  reason: string
  policyRefs: CommunicationPolicyRef[]
  componentOutcomes: CommunicationComponentOutcome[]
  matchedEdgeIds: string[]
  requiredEdgeIds: string[]
  created_at: number
}

interface BlockPage { blocks: BlockEvent[]; nextCursor: string | null }

const fetchActivity = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) => data)
  .handler(({ data }) => daemonClient().get<BlockPage>(`/api/teams/${encodeURIComponent(data.id)}/policy/blocks?limit=25`))

export const Route = createFileRoute('/teams/$id/activity')({
  loader: ({ params }) => fetchActivity({ data: params }),
  component: ActivityPage,
  errorComponent: ({ error, reset }) => <RecoveryState title="Policy activity unavailable" error={error} reset={reset} fallbackHref="/teams" />,
})

function ActivityPage() {
  const initial = Route.useLoaderData()
  const { id } = Route.useParams()
  const [page, setPage] = useState(initial)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadMore = async () => {
    if (!page.nextCursor) return
    setLoading(true); setError(null)
    try {
      const response = await fetch(`/api/teams/${encodeURIComponent(id)}/policy/blocks?limit=25&cursor=${encodeURIComponent(page.nextCursor)}`)
      if (!response.ok) throw new Error(`Could not load activity (${response.status})`)
      const next = (await response.json()) as BlockPage
      setPage({ blocks: [...page.blocks, ...next.blocks], nextCursor: next.nextCursor })
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setLoading(false) }
  }
  return <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6"><div><h1>blocked communication</h1><p className="muted">Durable denial evidence. Diagnostic simulations never create these records.</p></div><TeamTabs teamId={id} />
    <div className="space-y-3">{page.blocks.map((block) => <BlockCard key={block.id} block={block} />)}
      {page.blocks.length === 0 && <p className="card muted">No blocked communication has been recorded for this team.</p>}
    </div>
    {error && <p role="alert" className="err">{error}</p>}
    {page.nextCursor && <Button variant="ghost" disabled={loading} onClick={loadMore}>{loading ? 'Loading…' : 'Load older evidence'}</Button>}
  </div>
}

function BlockCard({ block }: { block: BlockEvent }) {
  return <details className="card team"><summary className="flex cursor-pointer list-none flex-wrap items-center gap-2"><strong className="mr-auto break-all">{block.reason_code}</strong><time className="text-xs text-mocha-light">{new Date(block.created_at).toLocaleString()}</time><ChevronDown className="h-4 w-4 transition-transform team-open:rotate-180" /></summary>
    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
      <Fact label="Path" value={`${endpoint(block.source_kind, block.source_id)} → ${endpoint(block.target_kind, block.target_id)}`} />
      <Fact label="Channel / origin" value={`${block.channel} · ${block.origin}`} />
      <Fact label="Operation" value={block.operation} />
      <Fact label="Attempt identity" value={`${block.attempt_kind}:${block.attempt_id}`} code />
      <Fact label="Reason" value={block.reason} wide />
    </dl>
    <h3 className="mt-5 text-sm">Policy revisions</h3><ul className="mt-2 text-sm">{block.policyRefs.map((ref) => <li key={`${ref.teamId}:${ref.revision}`}><code>{ref.teamId}</code> revision {ref.revision}</li>)}</ul>
    {block.componentOutcomes.length > 1 && <><h3 className="mt-5 text-sm">Cross-Team consent components</h3><div className="mt-2 overflow-x-auto"><table><thead><tr><th>Team</th><th>Required edge</th><th>Matched</th></tr></thead><tbody>{block.componentOutcomes.map((item) => <tr key={`${item.teamId}:${item.edge}`}><td><code>{item.teamId}</code></td><td className="break-all"><code>{item.edge}</code></td><td>{item.matched ? 'yes' : 'no'}</td></tr>)}</tbody></table></div></>}
    <div className="mt-4 grid gap-3 sm:grid-cols-2"><Fact label="Required edges" value={block.requiredEdgeIds.join(', ') || 'none'} code /><Fact label="Matched edges" value={block.matchedEdgeIds.join(', ') || 'none'} code /></div>
  </details>
}

function Fact({ label, value, code = false, wide = false }: { label: string; value: string; code?: boolean; wide?: boolean }) { return <div className={wide ? 'sm:col-span-2' : ''}><dt className="text-xs font-semibold uppercase text-mocha-light">{label}</dt><dd className="mt-1 break-words">{code ? <code className="break-all">{value}</code> : value}</dd></div> }
function endpoint(kind: string, id: string | null) { return id ? `${kind}:${id}` : kind }
