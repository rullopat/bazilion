import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { GroupTabs } from '../../../components/GroupTabs'
import { daemonClient } from '../../../lib/daemon-client'

interface BlockEvent {
  id: string
  source_kind: string
  source_id: string | null
  target_kind: string
  target_id: string | null
  origin: string
  reason_code: string
  created_at: number
}

interface BlockPage { blocks: BlockEvent[]; nextCursor: string | null }
const fetchActivity = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: string }) => data)
  .handler(({ data }) => daemonClient().get<BlockPage>(`/api/groups/${encodeURIComponent(data.id)}/harness/blocks?limit=25`))

export const Route = createFileRoute('/groups/$id/activity')({ loader: ({ params }) => fetchActivity({ data: params }), component: ActivityPage })

function ActivityPage() {
  const page = Route.useLoaderData()
  const { id } = Route.useParams()
  return <div className="mx-auto max-w-5xl px-6 py-8"><h1>blocked communication</h1><p className="muted">Durable denials evaluated against the current Group policy revision. This is not policy-change history.</p><GroupTabs groupId={id} /><div className="space-y-3">{page.blocks.map((block) => <article key={block.id} className="card"><div className="flex flex-wrap justify-between gap-2"><strong>{block.reason_code}</strong><time>{new Date(block.created_at).toLocaleString()}</time></div><p className="muted">{block.source_kind}{block.source_id ? `:${block.source_id}` : ''} → {block.target_kind}{block.target_id ? `:${block.target_id}` : ''} · {block.origin}</p></article>)}{page.blocks.length === 0 && <p className="card muted">No blocked communication has been recorded for this group.</p>}</div></div>
}
