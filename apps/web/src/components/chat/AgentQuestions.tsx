import type {
  AgentQuestion,
  AgentQuestionAnswer,
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
  const activity = useActivityOptional()
  const hydrated = useHydrated()
  const [text, setText] = useState('')
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

  if (answered !== null) {
    return (
      <p
        role="status"
        className="m-0 flex flex-wrap items-center gap-2 rounded-[10px] border border-border bg-muted px-3 py-2 text-sm"
      >
        <span className="text-mocha">{item.question.prompt}</span>
        <span className="font-semibold text-foreground">{answered}</span>
      </p>
    )
  }

  return (
    <article className="min-w-0 rounded-2xl border border-warning/35 bg-warning/[0.07] px-4 py-3.5">
      <p className="m-0 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-warning">
        <span className="size-[7px] shrink-0 rounded-full bg-warning" aria-hidden="true" />
        {agentName} is waiting for you
      </p>
      <p className="m-0 mt-1.5 break-words text-base font-semibold text-charcoal">
        {item.question.prompt}
      </p>
      <fieldset disabled={busy} className="m-0 mt-3 min-w-0 border-0 p-0">
        <legend className="sr-only">Answer this question</legend>
        <div className="flex flex-wrap gap-2">
          {item.question.choices.map((option, index) => {
            const suggested = item.question.recommendedIndex === index
            return (
              <button
                key={option.label}
                type="button"
                onClick={() => void submit({ kind: 'choice', index }, option.label)}
                className={`unstyled min-h-[3.25rem] min-w-0 flex-1 basis-56 rounded-[10px] bg-card px-3 py-2 text-left transition-colors hover:bg-accent/60 disabled:opacity-60 ${
                  suggested ? 'border-[1.5px] border-primary' : 'border border-border'
                }`}
              >
                <span
                  className={`flex flex-wrap items-center gap-2 text-sm font-bold ${
                    suggested ? 'text-accent-foreground' : 'text-foreground'
                  }`}
                >
                  <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                    {option.label}
                  </span>
                  {suggested && (
                    <span className="rounded-full bg-accent px-1.5 text-xs font-semibold">
                      Suggested
                    </span>
                  )}
                </span>
                {option.description && (
                  <span className="mt-0.5 block break-words text-sm text-mocha">
                    {option.description}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <form
          className="mt-2.5 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (text.trim()) void submit({ kind: 'text', text }, text.trim())
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
      <p className="m-0 mt-2 text-xs text-mocha">
        {hydrated
          ? `Waiting until ${new Date(item.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. `
          : ''}
        An answer is information only; it grants no permission.
      </p>
      {error && (
        <p role="alert" className="m-0 mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </article>
  )
}
