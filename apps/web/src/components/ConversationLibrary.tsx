import type { Conversation, ConversationListResponse, NewConversationInput, ProviderMessage } from '@bazilion/api-types'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Button } from './Button'

export function ConversationLibrary({ agentId, turnBusy, onCreated, renderHistory, initialConversationId }: {
  agentId: string
  turnBusy: boolean
  onCreated: () => Promise<void>
  renderHistory: (messages: ProviderMessage[]) => ReactNode
  initialConversationId?: string
}) {
  const [library, setLibrary] = useState<ConversationListResponse | null>(null)
  const [offset, setOffset] = useState(0)
  const [refresh, setRefresh] = useState(0)
  const [selected, setSelected] = useState<Conversation | null>(null)
  const [history, setHistory] = useState<ProviderMessage[] | null>(null)
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [busy, setBusy] = useState(false)
  const pendingKey = `bazilion:conversation-create:${agentId}`
  const pendingCreate = useRef<NewConversationInput | null>(null)
  useEffect(() => {
    try { pendingCreate.current = JSON.parse(sessionStorage.getItem(pendingKey) ?? 'null') }
    catch { pendingCreate.current = null }
  }, [pendingKey])
  function clearPending() {
    pendingCreate.current = null
    sessionStorage.removeItem(pendingKey)
  }
  const base = `/api/agents/${encodeURIComponent(agentId)}/conversations`

  useEffect(() => {
    if (!initialConversationId) return
    const controller = new AbortController()
    fetch(`${base}/${encodeURIComponent(initialConversationId)}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Retained conversation is unavailable')
        const body = await response.json() as { conversation: Conversation }
        if (!controller.signal.aborted) { setSelected(body.conversation); setTitle(body.conversation.title) }
      }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [base, initialConversationId])

  useEffect(() => {
    const controller = new AbortController()
    setLibrary(null)
    fetch(`${base}?limit=20&offset=${offset}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Could not load conversations.')
        const body = await response.json() as ConversationListResponse
        if (!controller.signal.aborted) setLibrary(body)
      })
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [base, offset, refresh])

  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    setHistory(null)
    setHistoryError('')
    fetch(`${base}/${encodeURIComponent(selected.id)}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('This conversation history is unavailable. You can still start a new conversation.')
        const body = await response.json() as { messages: ProviderMessage[] }
        if (!controller.signal.aborted) setHistory(body.messages)
      })
      .catch(error => { if (!controller.signal.aborted) setHistoryError(error.message) })
    return () => controller.abort()
  }, [base, selected?.id])

  async function create() {
    if (!library || busy || turnBusy) return
    setBusy(true)
    setError('')
    const request = pendingCreate.current ?? { requestId: crypto.randomUUID(), expectedSelection: library.selection }
    pendingCreate.current = request
    try {
      sessionStorage.setItem(pendingKey, JSON.stringify(request))
      const response = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) })
      const body = await response.json()
      if (!response.ok) {
        if (response.status === 409 || response.status === 400) clearPending()
        throw new Error(body.error ?? 'Could not create conversation.')
      }
      clearPending()
      setSelected(null)
      setOffset(0)
      setRefresh(value => value + 1)
      await onCreated()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not create conversation.')
    } finally { setBusy(false) }
  }

  async function rename() {
    if (!selected || busy) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${base}/${encodeURIComponent(selected.id)}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, expectedTitleRevision: selected.titleRevision }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Could not rename conversation.')
      setSelected(body.conversation)
      setRefresh(value => value + 1)
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not rename conversation.') }
    finally { setBusy(false) }
  }

  return <section aria-live="off" className="my-3 min-w-0 space-y-4 rounded-lg border border-fawn bg-ivory p-4" aria-label="Conversation library">
    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h2 className="m-0 text-lg">Conversations</h2>
      <Button variant="primary" disabled={!library || busy || turnBusy} onClick={() => void create()}>New conversation</Button>
    </div>
    <p className="m-0 text-sm">Starting a new conversation keeps previous history and saved files. Viewing history does not change the active conversation.</p>
    {turnBusy && <p role="status">Wait for the current turn to finish before starting a new conversation.</p>}
    {error && <p role="alert">{error} <Button variant="ghost" disabled={busy} onClick={() => { setError(''); setRefresh(value => value + 1) }}>Refresh library</Button></p>}
    {!library ? <p role="status">Loading conversations…</p> : <>
      {!library.total && <p>No conversations yet.</p>}
      <ul className="mt-4 grid list-none gap-2 p-0">
        {library.conversations.map(item => <li key={item.id} className="flex min-w-0 flex-col items-start gap-3 rounded border border-fawn p-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2"><span className="min-w-0 break-words [overflow-wrap:anywhere]">{item.title}</span>{item.id === library.selection.conversationId && <strong className="shrink-0 rounded-full bg-frost px-2 py-0.5 text-xs">Active</strong>}</span>
          <Button variant="ghost" className="max-w-full whitespace-normal break-words text-left sm:max-w-[50%]" disabled={busy} aria-pressed={selected?.id === item.id} onClick={() => { setSelected(item); setTitle(item.title) }}>View {item.title}</Button>
        </li>)}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="ghost" disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>Previous</Button>
        <Button variant="ghost" disabled={busy || offset + library.conversations.length >= library.total} onClick={() => setOffset(offset + 20)}>Next</Button>
        <span className="text-sm">{library.total} conversations</span>
      </div>
    </>}
    {selected && <section className="space-y-4 border-t border-fawn pt-4" aria-label="Retained conversation">
      <div className="grid min-w-0 grid-cols-2 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <label className="col-span-2 m-0 grid min-w-0 gap-2 sm:col-span-1">Conversation title<input className="h-11" value={title} maxLength={200} onChange={event => setTitle(event.target.value)} /></label>
        <Button variant="ghost" className="h-11" disabled={busy || !title.trim()} onClick={() => void rename()}>Rename</Button>
        <Button variant="ghost" className="h-11" disabled={busy} onClick={() => setSelected(null)}>Close history</Button>
      </div>
      <p className="m-0 text-sm">Viewing retained history. New messages still go to the active conversation.</p>
      {historyError ? <p role="alert">{historyError}</p> : history === null ? <p role="status">Loading history…</p> : history.length ? renderHistory(history) : <p>This conversation is empty.</p>}
    </section>}
  </section>
}
