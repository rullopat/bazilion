// Reviewed learning for one Agent: how its reviews run, the lessons a review proposed, and the
// reviews so far. Nothing a review proposes applies until the operator approves it.

import type {
  Agent,
  AgentLessonProposal,
  AgentReview,
  AgentReviewConfig,
  ListAgentLessonProposalsResponse,
  ListAgentReviewsResponse,
  ModelsResponse,
  ReasoningLevel,
} from '@bazilion/api-types'
import { REASONING_LEVELS } from '@bazilion/api-types'
import { BookOpenCheck, History, Lightbulb } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { type ApiInit, api, errorMessage } from '../../lib/api'
import type { Tone } from '../../lib/model-facts'
import { useHydrated, useResource } from '../../lib/use-resource'
import { Button } from '../Button'
import { ConfirmDialog } from '../ConfirmDialog'
import { MODELS_PATH, ModelMenu } from '../ModelMenu'
import {
  ChoiceCards,
  SaveBar,
  SelectField,
  SwitchRow,
  saveStatus,
  TextAreaField,
  TextField,
} from '../ui/form'
import {
  CardBody,
  CardEmpty,
  CardForm,
  CardList,
  Chip,
  ListRow,
  Notice,
  RowMenu,
  SetupCard,
} from '../ui/parts'

type Act = (path: string, init: ApiInit) => Promise<void>

export function AgentLearning({ agent }: { agent: Agent }) {
  const base = `/api/agents/${encodeURIComponent(agent.id)}`
  const data = useResource(
    async (signal) => {
      const [config, reviews, proposals] = await Promise.all([
        api<AgentReviewConfig>(`${base}/review-config`, { signal }),
        api<ListAgentReviewsResponse>(`${base}/reviews`, { signal }),
        api<ListAgentLessonProposalsResponse>(`${base}/lesson-proposals`, { signal }),
      ])
      return { config, reviews: reviews.reviews, proposals: proposals.proposals }
    },
    [base],
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const hydrated = useHydrated()
  const when = (at: number) => (hydrated ? new Date(at).toLocaleString() : '…')

  /** Run one request and reload; the failure shows here and is rethrown. */
  const act: Act = async (path, init) => {
    setError(null)
    setBusy(true)
    try {
      await api(path, init)
      await data.reload()
    } catch (cause) {
      setError(errorMessage(cause))
      throw cause
    } finally {
      setBusy(false)
    }
  }

  if (!data.data) {
    return data.error ? (
      <Notice role="alert" title="Reviewed learning could not be loaded.">
        {data.error}
      </Notice>
    ) : (
      <p role="status" className="m-0 text-sm text-muted-foreground">
        Loading reviewed learning…
      </p>
    )
  }
  const { config, reviews, proposals } = data.data
  const pending = proposals.filter((proposal) => proposal.status === 'pending')
  const decided = proposals.filter((proposal) => proposal.status !== 'pending')

  return (
    <div className="grid gap-5">
      {error && (
        <Notice role="alert" title="That did not work.">
          {error}
        </Notice>
      )}

      <SetupCard
        labelledBy="agent-reviews"
        icon={<BookOpenCheck className="size-5" />}
        title="Reviews"
        description={`A review reads ${agent.name}'s recent turns and proposes up to five lessons.`}
        action={
          <Button
            variant="ghost"
            disabled={busy || agent.status === 'archived'}
            onClick={() => void act(`${base}/reviews`, { method: 'POST' }).catch(() => {})}
          >
            Review now
          </Button>
        }
      >
        <ReviewSettings
          config={config}
          disabled={busy}
          // Its own Save bar says how a save went; the page's notice is for the other actions.
          onSave={async (body) => {
            await api(`${base}/review-config`, { method: 'PATCH', body })
            await data.reload()
          }}
        />
      </SetupCard>

      <SetupCard
        labelledBy="agent-lessons"
        icon={<Lightbulb className="size-5" />}
        title="Lessons"
        description="What reviews proposed. A lesson applies only once you approve it."
        action={
          pending.length > 0 && (
            <Chip tone="warning">
              {pending.length === 1 ? '1 to decide' : `${pending.length} to decide`}
            </Chip>
          )
        }
      >
        {proposals.length === 0 ? (
          <CardEmpty icon={<Lightbulb className="size-5" />} title="No lessons yet">
            A review proposes lessons when it finds something worth keeping; it may also find
            nothing.
          </CardEmpty>
        ) : (
          <>
            {pending.map((proposal) => (
              <PendingLesson
                key={`${proposal.id}:${proposal.version}`}
                proposal={proposal}
                base={`${base}/lesson-proposals/${encodeURIComponent(proposal.id)}`}
                busy={busy}
                act={act}
              />
            ))}
            {decided.length > 0 && (
              <CardList>
                {decided.map((proposal) => (
                  <DecidedLesson
                    key={proposal.id}
                    proposal={proposal}
                    base={`${base}/lesson-proposals/${encodeURIComponent(proposal.id)}`}
                    busy={busy}
                    act={act}
                  />
                ))}
              </CardList>
            )}
          </>
        )}
      </SetupCard>

      <SetupCard
        labelledBy="agent-review-history"
        icon={<History className="size-5" />}
        title="Reviews so far"
        description="Each review, what started it, and what it found."
      >
        {reviews.length === 0 ? (
          <CardEmpty title="No review has run yet" />
        ) : (
          <CardList>
            {reviews.map((review) => (
              <ReviewRow key={review.id} review={review} when={when(review.createdAt)} />
            ))}
          </CardList>
        )}
      </SetupCard>
    </div>
  )
}

function ReviewSettings({
  config,
  disabled,
  onSave,
}: {
  config: AgentReviewConfig
  disabled: boolean
  onSave: (body: Partial<AgentReviewConfig>) => Promise<void>
}) {
  const models = useResource((signal) => api<ModelsResponse>(MODELS_PATH, { signal }), [])
  const [enabled, setEnabled] = useState(config.enabled)
  const [every, setEvery] = useState(String(config.everyNTurns))
  const [model, setModel] = useState(config.model ?? '')
  const [reasoning, setReasoning] = useState<ReasoningLevel>(config.reasoningLevel)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const typed = Number(every)
  const typedOk = every !== '' && Number.isInteger(typed) && typed >= 1 && typed <= 100
  // The number matters only while reviews run on their own; hidden, it keeps the stored one.
  const turnsProblem = enabled && !typedOk ? 'From 1 to 100 turns.' : undefined
  const turns = typedOk ? typed : config.everyNTurns
  const dirty =
    enabled !== config.enabled ||
    turns !== config.everyNTurns ||
    model !== (config.model ?? '') ||
    reasoning !== config.reasoningLevel

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (turnsProblem) return
    setSaving(true)
    setFailed(null)
    try {
      await onSave({ enabled, everyNTurns: turns, model: model || null, reasoningLevel: reasoning })
      setSaved(true)
    } catch (cause) {
      setFailed(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <CardForm onSubmit={(event) => void submit(event)}>
      <SwitchRow
        label="Review on its own"
        description={
          enabled
            ? `After every ${typedOk ? typed : '…'} successful turns, reading at most the last 8 and 40,000 characters.`
            : 'Off: a review runs only when you press Review now.'
        }
        checked={enabled}
        disabled={disabled}
        onChange={(value) => {
          setEnabled(value)
          setSaved(false)
        }}
      />
      {enabled && (
        <TextField
          label="Every how many turns"
          value={every}
          inputMode="numeric"
          disabled={disabled}
          problem={turnsProblem}
          className="max-w-32"
          onChange={(value) => {
            setEvery(value.replace(/\D/g, ''))
            setSaved(false)
          }}
        />
      )}
      <div className="grid items-start gap-x-3 gap-y-4 sm:grid-cols-2">
        <ModelMenu
          kit
          disabled={disabled || saving}
          label="Model for reviews"
          value={model}
          onChange={(value) => {
            setModel(value)
            setSaved(false)
          }}
          models={models.data?.chat ?? []}
          inherited={{ label: 'The Agent’s own model' }}
        />
        <SelectField<ReasoningLevel>
          label="Reasoning"
          value={reasoning}
          options={REASONING_LEVELS.map((level) => ({ value: level, label: level }))}
          disabled={disabled}
          className="max-w-none"
          onChange={(value) => {
            setReasoning(value)
            setSaved(false)
          }}
        />
      </div>
      <SaveBar
        busy={saving}
        disabled={!dirty || disabled || Boolean(turnsProblem)}
        status={saveStatus({
          error: failed,
          dirty,
          saved,
          footnote: `${config.turnsSinceLast} successful turn${config.turnsSinceLast === 1 ? '' : 's'} since the last review.`,
        })}
      />
    </CardForm>
  )
}

const REVIEW: Record<AgentReview['status'], { label: string; tone: Tone }> = {
  pending: { label: 'Queued', tone: 'neutral' },
  running: { label: 'Running', tone: 'success' },
  completed: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

function ReviewRow({ review, when }: { review: AgentReview; when: string }) {
  const state = REVIEW[review.status]
  return (
    <ListRow
      inline
      title={when}
      chip={<Chip tone={state.tone}>{state.label}</Chip>}
      meta={
        <>
          <span>{review.trigger === 'manual' ? 'Started by you' : 'Ran on its own'}</span>
          <span>
            {review.turnsReviewed} turn{review.turnsReviewed === 1 ? '' : 's'} read
          </span>
          <span>
            {review.proposalCount === 0
              ? 'no lessons'
              : `${review.proposalCount} lesson${review.proposalCount === 1 ? '' : 's'} proposed`}
          </span>
        </>
      }
    >
      {review.lastError && (
        <p className="m-0 break-words text-sm text-danger">{review.lastError}</p>
      )}
    </ListRow>
  )
}

function Evidence({ proposal }: { proposal: AgentLessonProposal }) {
  const quotes = proposal.evidence.filter((item) => item.excerpt)
  if (quotes.length === 0) return null
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-semibold text-accent-foreground">
        What it is based on ({quotes.length})
      </summary>
      <ul className="m-0 mt-2 grid list-none gap-2 p-0">
        {quotes.map((item) => (
          <li
            key={`${item.sessionId}:${item.entryOrdinal}`}
            className="whitespace-pre-wrap break-words rounded-lg border-l-2 border-border bg-muted/40 px-3 py-2 text-muted-foreground"
          >
            {item.excerpt}
          </li>
        ))}
      </ul>
    </details>
  )
}

const SCOPES = [
  {
    value: 'private',
    label: 'This Agent only',
    hint: 'Added to its own instructions, for its future turns.',
  },
  {
    value: 'shared',
    label: 'The whole Team',
    hint: 'Kept in the Team’s shared memory, where every member can find it.',
  },
] as const

function PendingLesson({
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
  const [rejecting, setRejecting] = useState(false)
  const version = { version: proposal.version }
  const edited = text !== proposal.text || scope !== proposal.scope

  async function approve() {
    // An edit is saved first, so the lesson approved is the one on screen.
    if (edited) await act(base, { method: 'PATCH', body: { ...version, text, scope } })
    else await act(`${base}/approve`, { body: version })
  }

  return (
    <CardBody>
      <TextAreaField
        label="Proposed lesson"
        value={text}
        rows={3}
        disabled={busy}
        onChange={setText}
      />
      <ChoiceCards
        legend="If you approve it, it applies to"
        name={`lesson-scope-${proposal.id}`}
        value={scope}
        options={SCOPES}
        disabled={busy}
        onChange={setScope}
        notes={
          scope === 'shared' && (
            <span className="mt-1.5 block text-xs text-muted-foreground">
              Facts about you belong in the Team’s USER.md instead.
            </span>
          )
        }
      />
      <Evidence proposal={proposal} />
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy} onClick={() => void approve().catch(() => {})}>
          {edited ? 'Save the edit' : 'Approve'}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setRejecting(true)}>
          Reject
        </Button>
        {edited && (
          <span className="self-center text-sm text-warning">
            Edited: save it, then approve it.
          </span>
        )}
      </div>
      {rejecting && (
        <ConfirmDialog
          open
          title="Reject this lesson?"
          description={
            <p className="m-0">
              It never reaches the Agent’s instructions or the Team’s memory, and it cannot be
              approved later. Unsaved edits are discarded.
            </p>
          }
          confirmLabel="Reject the lesson"
          onOpenChange={(open) => {
            if (!open) setRejecting(false)
          }}
          onConfirm={() => act(`${base}/reject`, { body: version })}
        />
      )}
    </CardBody>
  )
}

const DECIDED: Record<
  Exclude<AgentLessonProposal['status'], 'pending'>,
  { label: string; tone: Tone }
> = {
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'neutral' },
  revoked: { label: 'Revoked', tone: 'neutral' },
}

function DecidedLesson({
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
  const [revoking, setRevoking] = useState(false)
  const state = DECIDED[proposal.status as keyof typeof DECIDED]
  return (
    <ListRow
      inline
      title={<span className="font-normal">{proposal.text}</span>}
      chip={<Chip tone={state.tone}>{state.label}</Chip>}
      meta={<span>{proposal.scope === 'shared' ? 'The whole Team' : 'This Agent only'}</span>}
      actions={
        proposal.status === 'approved' && (
          <RowMenu
            label="More for this lesson"
            disabled={busy}
            items={[{ label: 'Revoke…', danger: true, onSelect: () => setRevoking(true) }]}
          />
        )
      }
    >
      <Evidence proposal={proposal} />
      {revoking && (
        <ConfirmDialog
          open
          title="Revoke this lesson?"
          description={
            <p className="m-0">
              {proposal.scope === 'shared'
                ? 'Its note leaves the Team’s shared memory, so searches no longer find it.'
                : 'It leaves the Agent’s instructions from the next turn; past conversations stay as they were.'}{' '}
              It stays listed here as revoked.
            </p>
          }
          confirmLabel="Revoke the lesson"
          onOpenChange={(open) => {
            if (!open) setRevoking(false)
          }}
          onConfirm={() => act(`${base}/revoke`, { body: { version: proposal.version } })}
        />
      )}
    </ListRow>
  )
}
