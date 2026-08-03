import { ApiClientError } from '@bazilion/client'
import type {
  AgentLessonProposal,
  AgentReview,
  AgentReviewConfig,
  ListAgentLessonProposalsResponse,
  ListAgentReviewsResponse,
  ResolvedAgent,
} from '@bazilion/api-types'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { AgentTabs } from '../../../components/AgentTabs'
import { Button } from '../../../components/Button'
import { PageShell } from '../../../components/Page'
import { daemonClient } from '../../../lib/daemon-client'

interface LearningView {
  resolved: ResolvedAgent
  config: AgentReviewConfig
  reviews: AgentReview[]
  proposals: AgentLessonProposal[]
}

const fetchLearning = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<LearningView | null> => {
    const client = daemonClient()
    let resolved: ResolvedAgent
    try {
      resolved = await client.get<ResolvedAgent>(`/api/agents/${encodeURIComponent(data.id)}`)
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 404) return null
      throw error
    }
    const id = encodeURIComponent(resolved.agent.id)
    const [config, reviews, proposals] = await Promise.all([
      client.get<AgentReviewConfig>(`/api/agents/${id}/review-config`),
      client.get<ListAgentReviewsResponse>(`/api/agents/${id}/reviews`),
      client.get<ListAgentLessonProposalsResponse>(`/api/agents/${id}/lesson-proposals`),
    ])
    return { resolved, config, reviews: reviews.reviews, proposals: proposals.proposals }
  })

export const Route = createFileRoute('/agents/$id/learning')({
  loader: async ({ params }) => {
    const data = await fetchLearning({ data: { id: params.id } })
    if (!data) throw redirect({ to: '/agents' })
    return data
  },
  component: LearningPage,
})

function LearningPage() {
  const { resolved, config, reviews, proposals } = Route.useLoaderData()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function request(path: string, method: 'POST' | 'PATCH', body?: unknown) {
    setError(null)
    setBusy(true)
    try {
      const response = await fetch(path, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(detail?.error ?? `request failed (${response.status})`)
      }
      await router.invalidate()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const id = encodeURIComponent(resolved.agent.id)
  return (
    <PageShell>
      <header className="mb-6">
        <h1>{resolved.agent.name}</h1>
      </header>
      <AgentTabs agentId={resolved.agent.id} active="learning" archived={resolved.agent.status === 'archived'} />

      {error && <p className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}. Refresh before retrying if another operator changed this proposal.</p>}

      <section className="mb-8 rounded-lg border bg-card p-5">
        <h2 className="mb-2 text-xl">Reviewed learning</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Reviews inspect at most 8 successful user turns and 40,000 characters. They use {config.model ?? 'the Agent model'} at {config.reasoningLevel} reasoning, propose at most five lessons, and never apply anything without your approval.
        </p>
        <ReviewConfigForm agentId={resolved.agent.id} config={config} disabled={busy} onError={setError} onSaved={() => router.invalidate()} />
        <div className="mt-4 flex items-center gap-3">
          <Button variant="primary" disabled={busy || resolved.agent.status === 'archived'} onClick={() => request(`/api/agents/${id}/reviews`, 'POST')}>
            Review now
          </Button>
          {!config.enabled && <span className="text-sm text-muted-foreground">Periodic review is disabled; manual review remains available.</span>}
        </div>
      </section>

      <h2 className="mb-3 text-xl">Lesson proposals</h2>
      {proposals.length === 0 ? (
        <p className="mb-8 text-muted-foreground">No proposals yet. A successful review may also produce zero proposals.</p>
      ) : (
        <div className="mb-8 grid gap-3">
          {proposals.map((proposal) => (
            <ProposalCard key={proposal.id} proposal={proposal} agentId={resolved.agent.id} busy={busy} act={request} />
          ))}
        </div>
      )}

      <h2 className="mb-3 text-xl">Review history</h2>
      {reviews.length === 0 ? <p className="text-muted-foreground">No reviews have been queued.</p> : (
        <div className="overflow-x-auto"><table><thead><tr><th>created</th><th>trigger</th><th>status</th><th>turns</th><th>proposals</th><th>diagnostic</th></tr></thead><tbody>{reviews.map((review) => <tr key={review.id}><td>{new Date(review.createdAt).toLocaleString()}</td><td>{review.trigger}</td><td><code>{review.status}</code></td><td>{review.turnsReviewed}</td><td>{review.proposalCount}</td><td>{review.lastError ?? '—'}</td></tr>)}</tbody></table></div>
      )}
    </PageShell>
  )
}

function ReviewConfigForm({ agentId, config, disabled, onError, onSaved }: { agentId: string; config: AgentReviewConfig; disabled: boolean; onError: (value: string | null) => void; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(config.enabled)
  const [every, setEvery] = useState(config.everyNTurns)
  const [model, setModel] = useState(config.model ?? '')
  const [reasoning, setReasoning] = useState(config.reasoningLevel)
  async function submit(event: React.FormEvent) {
    event.preventDefault(); onError(null)
    const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/review-config`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled, everyNTurns: every, model: model.trim() || null, reasoningLevel: reasoning }) })
    if (!response.ok) { const detail = await response.json().catch(() => null) as { error?: string } | null; onError(detail?.error ?? `request failed (${response.status})`); return }
    onSaved()
  }
  return <form onSubmit={submit} className="grid gap-3 md:grid-cols-4"><label className="text-sm"><span className="block mb-1">Periodic review</span><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> enabled</label><label className="text-sm"><span className="block mb-1">Every turns</span><input type="number" min={1} max={100} value={every} onChange={(event) => setEvery(Number(event.target.value))} /></label><label className="text-sm"><span className="block mb-1">Model override</span><input value={model} placeholder="agent model" onChange={(event) => setModel(event.target.value)} /></label><label className="text-sm"><span className="block mb-1">Reasoning</span><select value={reasoning} onChange={(event) => setReasoning(event.target.value as AgentReviewConfig['reasoningLevel'])}><option>off</option><option>minimal</option><option>low</option><option>medium</option><option>high</option><option>xhigh</option></select></label><div><Button variant="primary" type="submit" disabled={disabled}>Save learning settings</Button></div></form>
}

function ProposalCard({ proposal, agentId, busy, act }: { proposal: AgentLessonProposal; agentId: string; busy: boolean; act: (path: string, method: 'POST' | 'PATCH', body?: unknown) => Promise<void> }) {
  const [text, setText] = useState(proposal.text)
  const [scope, setScope] = useState(proposal.scope)
  const base = `/api/agents/${encodeURIComponent(agentId)}/lesson-proposals/${encodeURIComponent(proposal.id)}`
  return <article className="rounded-lg border bg-card p-4"><div className="mb-2 flex justify-between gap-2"><code>{proposal.status}</code><span className="text-xs text-muted-foreground">v{proposal.version}</span></div>{proposal.status === 'pending' ? <><textarea className="w-full" rows={3} value={text} onChange={(event) => setText(event.target.value)} /><select className="mt-2" value={scope} onChange={(event) => setScope(event.target.value as AgentLessonProposal['scope'])}><option value="private">private Agent behavior</option><option value="shared">shared Team knowledge</option></select><div className="mt-3 flex flex-wrap gap-2"><Button variant="ghost" disabled={busy} onClick={() => act(base, 'PATCH', { version: proposal.version, text, scope })}>Save edit</Button><Button variant="primary" disabled={busy} onClick={() => act(`${base}/approve`, 'POST', { version: proposal.version })}>Approve</Button><Button variant="danger" disabled={busy} onClick={() => act(`${base}/reject`, 'POST', { version: proposal.version })}>Reject</Button></div></> : <><p>{proposal.text}</p>{proposal.status === 'approved' && <div className="mt-3"><Button variant="danger" disabled={busy} onClick={() => act(`${base}/revoke`, 'POST', { version: proposal.version })}>Revoke</Button></div>}</>}<div className="mt-3 text-xs text-muted-foreground">Evidence: {proposal.evidence.length === 0 ? 'none' : <ul className="mt-1 list-disc pl-5">{proposal.evidence.map((item) => <li key={`${item.sessionId}:${item.entryOrdinal}`}><code>{item.sessionId}:{item.entryOrdinal}</code>{item.excerpt ? ` — ${item.excerpt}` : ' — excerpt unavailable'}</li>)}</ul>}</div>{scope === 'shared' && <p className="mt-1 text-xs text-muted-foreground">Shared lessons become searchable Team memory. Stable facts about the human belong in Team USER.md instead.</p>}</article>
}
