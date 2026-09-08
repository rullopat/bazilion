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
  return <section aria-label="Agent questions" className="max-h-[40vh] min-w-0 shrink-0 space-y-3 overflow-y-auto border-t border-frost px-5 py-3">
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
  return <article className="flex min-w-0 flex-col gap-3 rounded-lg border border-frost bg-ivory p-3">
    <p className="m-0 break-words font-medium">{item.question.prompt}</p>
    <details className="text-xs text-mocha"><summary className="cursor-pointer">Question details · {item.status}</summary><p className="mt-2 break-all">Conversation {item.conversationId} · {item.continuation}</p></details>
    {item.status === 'pending' ? <form className="flex min-w-0 flex-col gap-3" onSubmit={event => {
      event.preventDefault()
      if (choice === 'other') void submit({ kind: 'text', text })
      else if (choice !== '') void submit({ kind: 'choice', index: Number(choice) })
    }}>
      <fieldset disabled={disabled} className="m-0 grid min-w-0 gap-2 border-0 p-0 sm:grid-cols-2">
        <legend className="sr-only">Answer this question</legend>
        {item.question.choices.map((option, index) => <label key={index} className="m-0 flex min-w-0 cursor-pointer items-center gap-2 rounded-md border border-frost px-3 py-2.5 has-[:checked]:border-sapphire has-[:checked]:bg-sapphire-glow">
          <input className="m-0 h-4 w-4 shrink-0 accent-sapphire" type="radio" name={`question-${item.id}`} value={index} checked={choice === String(index)} onChange={() => setChoice(String(index))} />
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{option.label}{item.question.recommendedIndex === index ? ' (Recommended)' : ''}{option.description && <small className="block">{option.description}</small>}</span>
        </label>)}
        <label className="m-0 flex min-w-0 cursor-pointer items-center gap-2 rounded-md border border-frost px-3 py-2.5 has-[:checked]:border-sapphire has-[:checked]:bg-sapphire-glow"><input className="m-0 h-4 w-4 shrink-0 accent-sapphire" type="radio" name={`question-${item.id}`} checked={choice === 'other'} onChange={() => setChoice('other')} /><span>Other</span></label>
        {choice === 'other' && <label className="m-0 grid gap-2 sm:col-span-2">Your answer<textarea rows={2} className="w-full resize-y" value={text} maxLength={4096} onChange={event => setText(event.target.value)} /></label>}
      </fieldset>
      {pending && <p className="break-words">Saved answer: {pending.answer.kind === 'choice' ? item.question.choices[pending.answer.index]?.label : pending.answer.kind === 'text' ? pending.answer.text : 'Skip'}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" type="submit" disabled={disabled || !choice || (choice === 'other' && (!text.trim() || new TextEncoder().encode(text).length > 4096))}>Send answer</Button>
        <Button variant="ghost" disabled={disabled} onClick={() => { void submit({ kind: 'skip' }) }}>Skip</Button>
        {pending && !item.answerApprovalId && <Button variant="ghost" disabled={busy} onClick={() => { void submit() }}>Retry same answer</Button>}
      </div>
      <p className="m-0 text-xs text-mocha">Clarification does not grant permission. This question expires at {new Date(item.expiresAt).toLocaleTimeString()}.</p>
      {item.answerApprovalId && <a href="/approvals">View communication approvals</a>}
    </form> : <p>{item.answer?.kind === 'choice' ? item.question.choices[item.answer.index]?.label : item.answer?.kind === 'text' ? item.answer.text : `No answer: ${item.noAnswerReason ?? item.status}`}. {item.continuation === 'consumed' ? 'Saved in the originating conversation; task completion is separate.' : item.continuation === 'interrupted' ? 'The waiting turn ended.' : 'Consumption has not been confirmed.'}</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
  </article>
}
