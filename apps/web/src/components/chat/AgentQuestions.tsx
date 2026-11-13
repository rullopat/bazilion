import type {
  AgentQuestion,
  AgentQuestionAnswer,
  AgentQuestionListResponse,
} from '@bazilion/api-types'
import { useEffect, useState } from 'react'
import { ApiError, api, errorMessage } from '../../lib/api'
import { Button } from '../Button'

/**
 * Questions the Agent is waiting on. The chat reloads them when it opens, when a turn starts or
 * ends and when its stream carries a new question (`refreshKey` changes).
 */
export function AgentQuestions({ agentId, refreshKey }: { agentId: string; refreshKey: number }) {
  const [items, setItems] = useState<AgentQuestion[]>([])
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is the reload signal.
  useEffect(() => {
    const controller = new AbortController()
    api<AgentQuestionListResponse>(`/api/agents/${encodeURIComponent(agentId)}/questions`, {
      signal: controller.signal,
    })
      .then((body) => setItems(body.questions))
      .catch(() => {
        // The next reload tries again.
      })
    return () => controller.abort()
  }, [agentId, refreshKey])
  if (!items.length) return null
  return (
    <section
      aria-label="Agent questions"
      className="max-h-[40vh] min-w-0 shrink-0 space-y-3 overflow-y-auto border-t border-frost px-5 py-3"
    >
      {items.map((item) => (
        <QuestionCard key={item.id} item={item} />
      ))}
    </section>
  )
}

function QuestionCard({ item }: { item: AgentQuestion }) {
  const [choice, setChoice] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  async function submit(answer: AgentQuestionAnswer) {
    setBusy(true)
    setError('')
    try {
      await api(
        `/api/agents/${encodeURIComponent(item.agentId)}/questions/${encodeURIComponent(item.id)}/answer`,
        { body: { answer } },
      )
      setDone(true)
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
  const disabled = busy || done
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-lg border border-frost bg-ivory p-3">
      <p className="m-0 break-words font-medium">{item.question.prompt}</p>
      <form
        className="flex min-w-0 flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (choice === 'other') void submit({ kind: 'text', text })
          else if (choice !== '') void submit({ kind: 'choice', index: Number(choice) })
        }}
      >
        <fieldset
          disabled={disabled}
          className="m-0 grid min-w-0 gap-2 border-0 p-0 sm:grid-cols-2"
        >
          <legend className="sr-only">Answer this question</legend>
          {item.question.choices.map((option, index) => (
            <label
              key={option.label}
              className="m-0 flex min-w-0 cursor-pointer items-center gap-2 rounded-md border border-frost px-3 py-2.5 has-[:checked]:border-sapphire has-[:checked]:bg-sapphire-glow"
            >
              <input
                className="m-0 h-4 w-4 shrink-0 accent-sapphire"
                type="radio"
                name={`question-${item.id}`}
                value={index}
                checked={choice === String(index)}
                onChange={() => setChoice(String(index))}
              />
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                {option.label}
                {item.question.recommendedIndex === index ? ' (Recommended)' : ''}
                {option.description && <small className="block">{option.description}</small>}
              </span>
            </label>
          ))}
          <label className="m-0 flex min-w-0 cursor-pointer items-center gap-2 rounded-md border border-frost px-3 py-2.5 has-[:checked]:border-sapphire has-[:checked]:bg-sapphire-glow">
            <input
              className="m-0 h-4 w-4 shrink-0 accent-sapphire"
              type="radio"
              name={`question-${item.id}`}
              checked={choice === 'other'}
              onChange={() => setChoice('other')}
            />
            <span>Other</span>
          </label>
          {choice === 'other' && (
            <label className="m-0 grid gap-2 sm:col-span-2">
              Your answer
              <textarea
                rows={2}
                className="w-full resize-y"
                value={text}
                maxLength={4096}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
          )}
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            type="submit"
            disabled={disabled || !choice || (choice === 'other' && !text.trim())}
          >
            Send answer
          </Button>
          <Button
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              void submit({ kind: 'skip' })
            }}
          >
            Skip
          </Button>
        </div>
        <p className="m-0 text-xs text-mocha">
          {done
            ? 'Answered.'
            : `Waiting until ${new Date(item.expiresAt).toLocaleTimeString()}. Answering grants no permission.`}
        </p>
      </form>
      {error && <p role="alert">{error}</p>}
    </article>
  )
}
