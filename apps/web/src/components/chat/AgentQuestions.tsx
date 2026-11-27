import type {
  AgentQuestion,
  AgentQuestionAnswer,
  AgentQuestionItem,
  AgentQuestionItemAnswer,
  AgentQuestionListResponse,
} from '@bazilion/api-types'
import { useEffect, useState } from 'react'
import { useActivityOptional } from '../../lib/activity'
import { ApiError, api, errorMessage } from '../../lib/api'
import { useHydrated } from '../../lib/use-resource'
import { Button } from '../Button'

/**
 * Questions the Agent is waiting on. The chat reloads them when it opens, when a turn starts or
 * ends and when its stream carries a new question (`refreshKey` changes); the live feed's count
 * of the Agent's questions reloads them too, so a question asked or answered elsewhere (a turn
 * started from the terminal, an answer given there or in Telegram, a timeout) shows here at once.
 */
export function AgentQuestions({
  agentId,
  agentName,
  refreshKey,
}: {
  agentId: string
  agentName: string
  refreshKey: number
}) {
  const [items, setItems] = useState<AgentQuestion[]>([])
  const waiting = useActivityOptional()?.byAgent.get(agentId)?.questions ?? 0
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey and waiting are reload signals.
  useEffect(() => {
    const controller = new AbortController()
    api<AgentQuestionListResponse>(`/api/agents/${encodeURIComponent(agentId)}/questions`, {
      signal: controller.signal,
    })
      .then((body) => setItems(body.questions))
      .catch(() => {
        // Best effort: the next refresh tries again.
      })
    return () => controller.abort()
  }, [agentId, refreshKey, waiting])
  if (!items.length) return null
  return (
    <section
      aria-label="Agent questions"
      className="max-h-[45vh] min-w-0 shrink-0 space-y-3 overflow-y-auto border-t border-frost px-5 py-3"
    >
      {items.map((item) => (
        <QuestionCard key={item.id} item={item} agentName={agentName} />
      ))}
    </section>
  )
}

function QuestionCard({ item, agentName }: { item: AgentQuestion; agentName: string }) {
  if (item.question.action) return <ActionCard item={item} agentName={agentName} />
  const items = item.question.questions ?? []
  const single = items.length === 1 && items[0] && !items[0].multiple ? items[0] : null
  return single ? (
    <SingleQuestionCard item={item} question={single} agentName={agentName} />
  ) : (
    <QuestionsCard item={item} agentName={agentName} />
  )
}

/** Send an answer; `onAnswered` gets the line to show in the card's place. */
function useAnswer(item: AgentQuestion) {
  const activity = useActivityOptional()
  const [busy, setBusy] = useState(false)
  const [answered, setAnswered] = useState<string | null>(null)
  const [error, setError] = useState('')
  async function submit(answer: AgentQuestionAnswer, shown: string) {
    setBusy(true)
    setError('')
    try {
      await api(
        `/api/agents/${encodeURIComponent(item.agentId)}/questions/${encodeURIComponent(item.id)}/answer`,
        { body: { answer } },
      )
      setAnswered(shown)
      activity?.refresh()
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 404
          ? 'This question is no longer open.'
          : errorMessage(cause),
      )
    } finally {
      setBusy(false)
    }
  }
  return { busy, answered, error, submit }
}

function Answered({ prompt, answered }: { prompt: string; answered: string }) {
  return (
    <p
      role="status"
      className="m-0 flex flex-wrap items-center gap-2 rounded-[10px] border border-border bg-muted px-3 py-2 text-sm"
    >
      <span className="text-mocha">{prompt}</span>
      <span className="font-semibold text-foreground">{answered}</span>
    </p>
  )
}

function Waiting({ agentName }: { agentName: string }) {
  return (
    <p className="m-0 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-warning">
      <span className="size-[7px] shrink-0 rounded-full bg-warning" aria-hidden="true" />
      {agentName} is waiting for you
    </p>
  )
}

function Footer({ item, error }: { item: AgentQuestion; error: string }) {
  const hydrated = useHydrated()
  return (
    <>
      <p className="m-0 mt-2 text-xs text-mocha">
        {hydrated && item.expiresAt !== null
          ? `Waiting until ${new Date(item.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. `
          : ''}
        An answer is information only; it grants no permission.
      </p>
      {error && (
        <p role="alert" className="m-0 mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </>
  )
}

function ChoiceButton({
  label,
  description,
  suggested,
  pressed,
  onClick,
}: {
  label: string
  description?: string | undefined
  suggested: boolean
  pressed?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      className={`unstyled min-h-[3.25rem] min-w-0 flex-1 basis-56 rounded-[10px] px-3 py-2 text-left transition-colors hover:bg-accent/60 disabled:opacity-60 ${
        pressed ? 'bg-accent' : 'bg-card'
      } ${suggested || pressed ? 'border-[1.5px] border-primary' : 'border border-border'}`}
    >
      <span
        className={`flex flex-wrap items-center gap-2 text-sm font-bold ${
          suggested ? 'text-accent-foreground' : 'text-foreground'
        }`}
      >
        <span className="min-w-0 break-words [overflow-wrap:anywhere]">{label}</span>
        {suggested && (
          <span className="rounded-full bg-accent px-1.5 text-xs font-semibold">Suggested</span>
        )}
      </span>
      {description && (
        <span className="mt-0.5 block break-words text-sm text-mocha">{description}</span>
      )}
    </button>
  )
}

/** One question with one choice to pick: a tap answers it. */
function SingleQuestionCard({
  item,
  question,
  agentName,
}: {
  item: AgentQuestion
  question: AgentQuestionItem
  agentName: string
}) {
  const [text, setText] = useState('')
  const { busy, answered, error, submit } = useAnswer(item)
  if (answered !== null) return <Answered prompt={question.prompt} answered={answered} />
  return (
    <article className="min-w-0 rounded-2xl border border-warning/35 bg-warning/[0.07] px-4 py-3.5">
      <Waiting agentName={agentName} />
      <p className="m-0 mt-1.5 break-words text-base font-semibold text-charcoal">
        {question.prompt}
      </p>
      <fieldset disabled={busy} className="m-0 mt-3 min-w-0 border-0 p-0">
        <legend className="sr-only">Answer this question</legend>
        <div className="flex flex-wrap gap-2">
          {question.choices.map((option, index) => (
            <ChoiceButton
              key={option.label}
              label={option.label}
              description={option.description}
              suggested={question.recommendedIndex === index}
              onClick={() =>
                void submit({ kind: 'answers', answers: [{ kind: 'choice', index }] }, option.label)
              }
            />
          ))}
        </div>
        <form
          className="mt-2.5 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (text.trim())
              void submit({ kind: 'answers', answers: [{ kind: 'text', text }] }, text.trim())
          }}
        >
          <input
            aria-label="Answer in your own words"
            placeholder="Or answer in your own words"
            value={text}
            maxLength={4096}
            onChange={(event) => setText(event.target.value)}
            className="min-h-10 min-w-0 flex-1 basis-48 text-sm"
          />
          {text.trim() && (
            <Button variant="primary" type="submit" className="min-h-10">
              Send answer
            </Button>
          )}
          <Button
            variant="ghost"
            className="min-h-10"
            onClick={() => void submit({ kind: 'skip' }, 'Skipped')}
          >
            Skip
          </Button>
        </form>
      </fieldset>
      <Footer item={item} error={error} />
    </article>
  )
}

/** What the owner has picked for one question of a card. */
type Draft = { picked: number[]; text: string; skipped: boolean }

function draftAnswer(question: AgentQuestionItem, draft: Draft): AgentQuestionItemAnswer | null {
  if (draft.skipped) return { kind: 'skip' }
  if (draft.text.trim()) return { kind: 'text', text: draft.text }
  if (draft.picked.length === 0) return null
  return question.multiple
    ? { kind: 'choices', indexes: [...draft.picked].sort((a, b) => a - b) }
    : { kind: 'choice', index: draft.picked[0] as number }
}

function draftWords(question: AgentQuestionItem, draft: Draft): string {
  if (draft.skipped) return 'Skipped'
  if (draft.text.trim()) return draft.text.trim()
  return draft.picked.map((index) => question.choices[index]?.label ?? '').join(', ')
}

/** Several questions, or one with several choices: picked first, sent together. */
function QuestionsCard({ item, agentName }: { item: AgentQuestion; agentName: string }) {
  const questions = item.question.questions ?? []
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    questions.map(() => ({ picked: [], text: '', skipped: false })),
  )
  const { busy, answered, error, submit } = useAnswer(item)
  const answers = questions.map((question, index) =>
    draftAnswer(question, drafts[index] ?? { picked: [], text: '', skipped: false }),
  )
  const ready = answers.every((answer) => answer !== null)
  if (answered !== null) {
    return <Answered prompt={questions[0]?.prompt ?? 'Questions'} answered={answered} />
  }
  const change = (index: number, next: Partial<Draft>) =>
    setDrafts((current) =>
      current.map((draft, at) => (at === index ? { ...draft, ...next } : draft)),
    )
  return (
    <article className="min-w-0 rounded-2xl border border-warning/35 bg-warning/[0.07] px-4 py-3.5">
      <Waiting agentName={agentName} />
      <fieldset disabled={busy} className="m-0 mt-1.5 min-w-0 space-y-4 border-0 p-0">
        <legend className="sr-only">Answer these questions</legend>
        {questions.map((question, index) => {
          const draft = drafts[index] ?? { picked: [], text: '', skipped: false }
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: a card's questions never change or reorder.
            <div key={index} className="min-w-0">
              <p className="m-0 break-words text-base font-semibold text-charcoal">
                {questions.length > 1 ? `${index + 1}. ` : ''}
                {question.prompt}
              </p>
              {question.multiple && (
                <p className="m-0 text-xs text-mocha">Pick as many as apply.</p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {question.choices.map((option, at) => (
                  <ChoiceButton
                    key={option.label}
                    label={option.label}
                    description={option.description}
                    suggested={question.recommendedIndex === at}
                    pressed={draft.picked.includes(at)}
                    onClick={() =>
                      change(index, {
                        skipped: false,
                        text: '',
                        picked: question.multiple
                          ? draft.picked.includes(at)
                            ? draft.picked.filter((value) => value !== at)
                            : [...draft.picked, at]
                          : [at],
                      })
                    }
                  />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  aria-label={`Question ${index + 1} in your own words`}
                  placeholder="Or answer in your own words"
                  value={draft.text}
                  maxLength={4096}
                  onChange={(event) =>
                    change(index, { text: event.target.value, picked: [], skipped: false })
                  }
                  className="min-h-10 min-w-0 flex-1 basis-48 text-sm"
                />
                <Button
                  variant="ghost"
                  className="min-h-10"
                  aria-pressed={draft.skipped}
                  onClick={() => change(index, { skipped: !draft.skipped, picked: [], text: '' })}
                >
                  {draft.skipped ? 'Skipped' : 'Skip this one'}
                </Button>
              </div>
            </div>
          )
        })}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            className="min-h-10"
            disabled={!ready}
            onClick={() =>
              void submit(
                { kind: 'answers', answers: answers as AgentQuestionItemAnswer[] },
                questions
                  .map((question, index) =>
                    draftWords(question, drafts[index] ?? { picked: [], text: '', skipped: false }),
                  )
                  .join(' · '),
              )
            }
          >
            Send answers
          </Button>
          <Button
            variant="ghost"
            className="min-h-10"
            onClick={() => void submit({ kind: 'skip' }, 'Skipped')}
          >
            Skip all
          </Button>
        </div>
      </fieldset>
      <Footer item={item} error={error} />
    </article>
  )
}

/** Something only the owner can do; it does not hold the turn, and Done or Can't starts the next. */
function ActionCard({ item, agentName }: { item: AgentQuestion; agentName: string }) {
  const action = item.question.action
  const [note, setNote] = useState('')
  const { busy, answered, error, submit } = useAnswer(item)
  if (!action) return null
  if (answered !== null) return <Answered prompt={action.reason} answered={answered} />
  const withNote = note.trim() ? { note: note.trim() } : {}
  return (
    <article className="min-w-0 rounded-2xl border border-warning/35 bg-warning/[0.07] px-4 py-3.5">
      <p className="m-0 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-warning">
        <span className="size-[7px] shrink-0 rounded-full bg-warning" aria-hidden="true" />
        {agentName} needs you to do something
      </p>
      <p className="m-0 mt-1.5 break-words text-base font-semibold text-charcoal">
        {action.reason}
      </p>
      <p className="m-0 mt-1 whitespace-pre-wrap break-words text-sm text-mocha">
        {action.instructions}
      </p>
      {action.url && (
        <p className="m-0 mt-1.5 text-sm">
          <a href={action.url} target="_blank" rel="noopener noreferrer" className="break-all">
            {action.url}
          </a>
        </p>
      )}
      <fieldset disabled={busy} className="m-0 mt-3 min-w-0 border-0 p-0">
        <legend className="sr-only">Answer this request</legend>
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label="A note for the Agent"
            placeholder="A note for the Agent (optional)"
            value={note}
            maxLength={4096}
            onChange={(event) => setNote(event.target.value)}
            className="min-h-10 min-w-0 flex-1 basis-48 text-sm"
          />
          <Button
            variant="primary"
            className="min-h-10"
            onClick={() => void submit({ kind: 'done', ...withNote }, 'Done')}
          >
            Done
          </Button>
          <Button
            variant="ghost"
            className="min-h-10"
            onClick={() => void submit({ kind: 'cannot', ...withNote }, "Can't")}
          >
            Can't
          </Button>
        </div>
      </fieldset>
      <p className="m-0 mt-2 text-xs text-mocha">
        {agentName} is not waiting in a turn: your answer starts its next one.
      </p>
      {error && (
        <p role="alert" className="m-0 mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </article>
  )
}
