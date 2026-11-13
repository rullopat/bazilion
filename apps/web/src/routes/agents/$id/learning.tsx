import type {
  AgentLessonProposal,
  AgentReviewConfig,
  ListAgentLessonProposalsResponse,
  ListAgentReviewsResponse,
} from '@bazilion/api-types'
import { REASONING_LEVELS } from '@bazilion/api-types'
import { createFileRoute, getRouteApi, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { Button } from '../../../components/Button'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { ItemList, ItemRow, SectionCard } from '../../../components/Page'
import { type ApiInit, api, errorMessage } from '../../../lib/api'
import { daemonClient } from '../../../lib/daemon-client'

const agentRoute = getRouteApi('/agents/$id')

const fetchLearning = createServerFn({ method: 'GET' })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const client = daemonClient()
    const agent = `/api/agents/${encodeURIComponent(data.id)}`
    const [config, reviews, proposals] = await Promise.all([
      client.get<AgentReviewConfig>(`${agent}/review-config`),
      client.get<ListAgentReviewsResponse>(`${agent}/reviews`),
      client.get<ListAgentLessonProposalsResponse>(`${agent}/lesson-proposals`),
    ])
    return { config, reviews: reviews.reviews, proposals: proposals.proposals }
  })

export const Route = createFileRoute('/agents/$id/learning')({
  loader: ({ params }) => fetchLearning({ data: { id: params.id } }),
  component: LearningPage,
})

type Act = (path: string, init: ApiInit) => Promise<void>

function LearningPage() {
  const { agent } = agentRoute.useLoaderData()
  const { config, reviews, proposals } = Route.useLoaderData()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const base = `/api/agents/${encodeURIComponent(agent.id)}`

  /** Run one request and reload; the failure shows on the page and is rethrown. */
  const act: Act = async (path, init) => {
    setError(null)
    setBusy(true)
    try {
      await api(path, init)
      await router.invalidate()
    } catch (cause) {
      setError(errorMessage(cause))
      throw cause
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="err">
          {error}
        </p>
      )}

      <SectionCard
        title="Reviewed learning"
        description={
          <>
            A review reads at most 8 successful user turns and 40,000 characters with{' '}
            {config.model ?? 'the Agent model'} at {config.reasoningLevel} reasoning and proposes at
            most five lessons. Nothing is applied until you approve it.
          </>
        }
      >
        <ReviewConfigForm
          config={config}
          disabled={busy}
          onSave={(body) => act(`${base}/review-config`, { method: 'PATCH', body })}
        />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            disabled={busy || agent.status === 'archived'}
            onClick={() => void act(`${base}/reviews`, { method: 'POST' }).catch(() => {})}
          >
            Review now
          </Button>
          {!config.enabled && (
            <span className="text-sm text-muted-foreground">
              Periodic review is off; Review now still works.
            </span>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Lesson proposals">
        {proposals.length === 0 ? (
          <p className="text-muted-foreground">
            No proposals yet. A successful review may also produce none.
          </p>
        ) : (
          <div className="grid gap-3">
            {proposals.map((proposal) => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                base={`${base}/lesson-proposals/${encodeURIComponent(proposal.id)}`}
                busy={busy}
                act={act}
              />
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Review history">
        {reviews.length === 0 ? (
          <p className="text-muted-foreground">No reviews have been queued.</p>
        ) : (
          <ItemList>
            {reviews.map((review) => (
              <ItemRow
                key={review.id}
                title={new Date(review.createdAt).toLocaleString()}
                meta={
                  <>
                    <code>{review.status}</code>
                    <span>{review.trigger}</span>
                    <span>{review.turnsReviewed} turns</span>
                    <span>{review.proposalCount} proposals</span>
                  </>
                }
              >
                {review.lastError && (
                  <p className="mb-0 mt-1 break-words text-sm text-danger">{review.lastError}</p>
                )}
              </ItemRow>
            ))}
          </ItemList>
        )}
      </SectionCard>
    </div>
  )
}

function ReviewConfigForm({
  config,
  disabled,
  onSave,
}: {
  config: AgentReviewConfig
  disabled: boolean
  onSave: (body: Partial<AgentReviewConfig>) => Promise<void>
}) {
  const [enabled, setEnabled] = useState(config.enabled)
  const [every, setEvery] = useState(config.everyNTurns)
  const [model, setModel] = useState(config.model ?? '')
  const [reasoning, setReasoning] = useState(config.reasoningLevel)

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void onSave({
          enabled,
          everyNTurns: every,
          model: model.trim() || null,
          reasoningLevel: reasoning,
        }).catch(() => {})
      }}
      className="grid items-end gap-x-3 md:grid-cols-4"
    >
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        Periodic review
      </label>
      <label>
        Every N turns
        <input
          type="number"
          min={1}
          max={100}
          value={every}
          onChange={(event) => setEvery(Number(event.target.value))}
        />
      </label>
      <label>
        Model override
        <input
          value={model}
          placeholder="the Agent model"
          onChange={(event) => setModel(event.target.value)}
        />
      </label>
      <label>
        Reasoning
        <select
          value={reasoning}
          onChange={(event) =>
            setReasoning(event.target.value as AgentReviewConfig['reasoningLevel'])
          }
        >
          {REASONING_LEVELS.map((level) => (
            <option key={level}>{level}</option>
          ))}
        </select>
      </label>
      <div className="md:col-span-4">
        <Button variant="primary" type="submit" disabled={disabled}>
          Save learning settings
        </Button>
      </div>
    </form>
  )
}

function ProposalCard({
  proposal,
  base,
  busy,
  act,
}: {
  proposal: AgentLessonProposal
  base: string
  busy: boolean
  act: Act
}) {
  const [text, setText] = useState(proposal.text)
  const [scope, setScope] = useState(proposal.scope)
  const [confirm, setConfirm] = useState<'reject' | 'revoke' | null>(null)
  const version = { version: proposal.version }
  const summary = proposal.text.length > 54 ? `${proposal.text.slice(0, 51)}…` : proposal.text

  return (
    <article className="rounded-lg border bg-card p-4">
      <div className="mb-2 flex justify-between gap-2">
        <code>{proposal.status}</code>
        <span className="text-xs text-muted-foreground">v{proposal.version}</span>
      </div>
      {proposal.status === 'pending' ? (
        <>
          <label>
            Proposed lesson
            <textarea rows={3} value={text} onChange={(event) => setText(event.target.value)} />
          </label>
          <label>
            Apply the approved lesson to
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value as AgentLessonProposal['scope'])}
            >
              <option value="private">private Agent behavior</option>
              <option value="shared">shared Team knowledge</option>
            </select>
          </label>
          {scope === 'shared' && (
            <p className="text-xs text-muted-foreground">
              Shared lessons become searchable Team memory. Stable facts about you belong in the
              Team's USER.md instead.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void act(base, { method: 'PATCH', body: { ...version, text, scope } }).catch(
                  () => {},
                )
              }
            >
              Save edit
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void act(`${base}/approve`, { body: version }).catch(() => {})}
            >
              Approve
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => setConfirm('reject')}>
              Reject
            </Button>
          </div>
        </>
      ) : (
        <>
          <p>{proposal.text}</p>
          {proposal.status === 'approved' && (
            <div className="mt-3">
              <Button variant="danger" disabled={busy} onClick={() => setConfirm('revoke')}>
                Revoke
              </Button>
            </div>
          )}
        </>
      )}
      <div className="mt-3 text-xs text-muted-foreground">
        Evidence:{' '}
        {proposal.evidence.length === 0 ? (
          'none'
        ) : (
          <ul className="mt-1 list-disc pl-5">
            {proposal.evidence.map((item) => (
              <li key={`${item.sessionId}:${item.entryOrdinal}`}>
                <code>
                  {item.sessionId}:{item.entryOrdinal}
                </code>
                {item.excerpt ? ` — ${item.excerpt}` : ' — excerpt unavailable'}
              </li>
            ))}
          </ul>
        )}
      </div>

      {confirm && (
        <ConfirmDialog
          open
          title={confirm === 'reject' ? `Reject “${summary}”?` : `Revoke “${summary}”?`}
          description={
            confirm === 'reject' ? (
              <p>
                The proposal is marked rejected and never changes the Agent's prompts or Team
                memory; unsaved edits are discarded. A rejected proposal cannot be edited or
                approved later.
              </p>
            ) : proposal.scope === 'shared' ? (
              <p>
                The lesson note is removed from Team memory, so Team-memory search no longer finds
                it. The proposal stays in the review history.
              </p>
            ) : (
              <p>
                The lesson is removed from the Agent's future prompts; past conversations are not
                rewritten. The proposal stays in the review history.
              </p>
            )
          }
          confirmLabel={confirm === 'reject' ? 'Reject proposal' : 'Revoke lesson'}
          onOpenChange={(open) => {
            if (!open) setConfirm(null)
          }}
          onConfirm={() => act(`${base}/${confirm}`, { body: version })}
        />
      )}
    </article>
  )
}
