import type { AgentQuestion, AgentQuestionAnswer, AgentQuestionListResponse, AgentQuestionResponse, AgentQuestionResponseInput } from '@bazilion/api-types'
import { useEffect, useRef, useState } from 'react'
import { Button } from './Button'

export function AgentQuestions({ agentId }: { agentId: string }) {
  const [items, setItems] = useState<AgentQuestion[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    let running = false
    const refresh = async () => {
      if (running) return
      running = true
      try {
        const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/questions`, { cache: 'no-store' })
        if (!response.ok) throw new Error('Questions could not be refreshed')
        const body = await response.json() as AgentQuestionListResponse
        if (live) { setItems(body.questions); setError('') }
      } catch (e) { if (live) { setItems([]); setError(e instanceof Error ? e.message : 'Questions unavailable') } }
      finally { running = false }
    }
    void refresh()
    const timer = setInterval(() => { void refresh() }, 2_000)
    return () => { live = false; clearInterval(timer) }
  }, [agentId])
  if (!items.length && !error) return null
  return <section aria-label="Agent questions" className="max-h-[45vh] shrink-0 overflow-auto border-t border-frost p-3">
    {error && <p role="status">{error}</p>}
    {items.filter(item => item.status === 'pending' || item.continuation === 'unconfirmed').map(item =>
      <QuestionCard key={item.id} item={item} />)}
    {items.some(item => item.status !== 'pending' && item.continuation !== 'unconfirmed') && <details>
      <summary>Recent question outcomes</summary>
      {items.filter(item => item.status !== 'pending' && item.continuation !== 'unconfirmed').map(item => <QuestionCard key={item.id} item={item} />)}
    </details>}
  </section>
}

function QuestionCard({ item }: { item: AgentQuestion }) {
  const storageKey = `bazilion-question-answer:${item.agentId}:${item.id}`
  const [choice, setChoice] = useState<string>('')
  const [text, setText] = useState('')
  const [pending, setPending] = useState<AgentQuestionResponseInput | null>(null)
  const pendingRef = useRef<AgentQuestionResponseInput | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey)
      if (saved) { const value = JSON.parse(saved) as AgentQuestionResponseInput; pendingRef.current = value; setPending(value) }
      setReady(true)
    } catch { setError('Answer recovery storage is unavailable. Enable session storage before answering.') }
  }, [storageKey])
  useEffect(() => {
    if (item.status === 'pending') return
    try { sessionStorage.removeItem(storageKey); pendingRef.current = null; setPending(null) } catch {}
  }, [item.status, storageKey])
  async function submit(answer?: AgentQuestionAnswer) {
    if (locked.current || !ready || item.status !== 'pending') return
    locked.current = true; setBusy(true); setError('')
    try {
      if (!pendingRef.current && !answer) throw new Error('Choose an answer first')
      const input = pendingRef.current ?? { requestId: crypto.randomUUID(), conversationId: item.conversationId, answer: answer as AgentQuestionAnswer }
      sessionStorage.setItem(storageKey, JSON.stringify(input))
      pendingRef.current = input; setPending(input)
      const response = await fetch(`/api/agents/${encodeURIComponent(item.agentId)}/questions/${encodeURIComponent(item.id)}/answer`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
      }).catch(() => { throw new Error('Answer acknowledgement unavailable. Retry the same answer.') })
      if (!response.ok) {
        if (response.status === 409 || response.status === 404) throw new Error('This question is no longer answerable. Its outcome will refresh shortly.')
        throw new Error('Answer acknowledgement unavailable. Retry the same answer.')
      }
      const outcome = await response.json() as AgentQuestionResponse
      if (outcome.kind === 'held') setNotice('Answer awaits communication approval. The Agent has not received it.')
      else {
        sessionStorage.removeItem(storageKey)
        setNotice('Answer accepted. Waiting for saved conversation evidence that the Agent consumed it.')
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Answer failed') }
    finally { locked.current = false; setBusy(false) }
  }
  const disabled = !ready || busy || !!pending || item.status !== 'pending' || !!item.answerApprovalId
  return <article className="my-2 min-w-0 rounded-md border border-frost p-3">
    <p className="break-words font-medium">{item.question.prompt}</p>
    <p className="break-all text-xs">Conversation {item.conversationId} · {item.status} · {item.continuation}</p>
    {item.status === 'pending' ? <form onSubmit={event => {
      event.preventDefault()
      if (choice === 'other') void submit({ kind: 'text', text })
      else if (choice !== '') void submit({ kind: 'choice', index: Number(choice) })
    }}>
      <fieldset disabled={disabled} className="grid gap-2 py-2">
        <legend className="sr-only">Answer this question</legend>
        {item.question.choices.map((option, index) => <label key={index} className="flex items-start gap-2 break-words">
          <input type="radio" name={`question-${item.id}`} value={index} checked={choice === String(index)} onChange={() => setChoice(String(index))} />
          <span className="min-w-0">{option.label}{item.question.recommendedIndex === index ? ' (Recommended)' : ''}{option.description && <small className="block">{option.description}</small>}</span>
        </label>)}
        <label><input type="radio" name={`question-${item.id}`} checked={choice === 'other'} onChange={() => setChoice('other')} /> Other</label>
        {choice === 'other' && <label>Your answer<textarea className="w-full" value={text} maxLength={4096} onChange={event => setText(event.target.value)} /></label>}
      </fieldset>
      {pending && <p className="break-words">Saved answer: {pending.answer.kind === 'choice' ? item.question.choices[pending.answer.index]?.label : pending.answer.kind === 'text' ? pending.answer.text : 'Skip'}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" type="submit" disabled={disabled || !choice || (choice === 'other' && (!text.trim() || new TextEncoder().encode(text).length > 4096))}>Send answer</Button>
        <Button variant="ghost" disabled={disabled} onClick={() => { void submit({ kind: 'skip' }) }}>Skip</Button>
        {pending && !item.answerApprovalId && <Button variant="ghost" disabled={busy} onClick={() => { void submit() }}>Retry same answer</Button>}
      </div>
      <p className="text-xs">Clarification does not grant permission. This question expires at {new Date(item.expiresAt).toLocaleTimeString()}.</p>
      {item.answerApprovalId && <a href="/approvals">View communication approvals</a>}
    </form> : <p>{item.answer?.kind === 'choice' ? item.question.choices[item.answer.index]?.label : item.answer?.kind === 'text' ? item.answer.text : `No answer: ${item.noAnswerReason ?? item.status}`}. {item.continuation === 'consumed' ? 'Saved in the originating conversation; task completion is separate.' : item.continuation === 'interrupted' ? 'The waiting turn ended.' : 'Consumption has not been confirmed.'}</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
  </article>
}
