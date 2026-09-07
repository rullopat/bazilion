import type { Attachment, ConversationSelection, UserQueueItem, UserQueueListResponse } from '@bazilion/api-types'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { queueJournal, type PendingQueueRequest } from '../lib/queue-journal'
import { Button } from './Button'

export interface UserQueueHandle {
  enqueue: (message: string, attachments: Attachment[], selection?: ConversationSelection) => Promise<boolean>
  stop: () => Promise<boolean>
}
export const UserQueuePanel = forwardRef<UserQueueHandle, {
  agentId: string
  onViewConversation: (id: string) => void
  selection: () => ConversationSelection | undefined
  onQueueMode: (queued: boolean) => void
}>(function UserQueuePanel({ agentId, selection, onQueueMode, onViewConversation }, ref) {
  const base = `/api/agents/${encodeURIComponent(agentId)}/queue`
  const [state, setState] = useState<UserQueueListResponse | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const readyRef = useRef(false)
  const [pending, setPending] = useState<PendingQueueRequest | null>(null)
  const pendingRef = useRef<PendingQueueRequest | null>(null)
  const locked = useRef(false)
  const mounted = useRef(true)
  const refreshGeneration = useRef(0)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [editing, setEditing] = useState<UserQueueItem | null>(null)
  const [text, setText] = useState('')
  const [editFiles, setEditFiles] = useState<Attachment[]>([])
  const [history, setHistory] = useState(false)
  const [offset, setOffset] = useState(0)
  const modeRef = useRef(onQueueMode)
  modeRef.current = onQueueMode
  async function refresh() {
    const generation = ++refreshGeneration.current
    const response = await fetch(`${base}?all=${history ? 1 : 0}&offset=${offset}`)
    if (!response.ok) throw new Error('Queue could not be loaded')
    const body: UserQueueListResponse = await response.json()
    const activeResponse = history ? await fetch(base) : null
    const active = activeResponse?.ok ? await activeResponse.json() as UserQueueListResponse : body
    if (mounted.current && generation === refreshGeneration.current) {
      setState(body)
      if (readyRef.current) modeRef.current(active.total > 0 || active.control.paused || !!pendingRef.current)
    }
    return body
  }
  useEffect(() => {
    let live = true
    queueJournal(agentId).then(value => { if (live) { pendingRef.current = value; setPending(value); readyRef.current = true; setReady(true); void refresh().catch(e => setError(e.message)) } }).catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [agentId])
  useEffect(() => {
    void refresh().catch(e => setError(e.message))
    const timer = setInterval(() => { void refresh().catch(e => setError(e.message)) }, 2_000)
    return () => clearInterval(timer)
  }, [agentId, history, offset])
  async function clearPending(record: PendingQueueRequest) {
    await queueJournal(agentId, null, record.input.requestId)
    const remaining = await queueJournal(agentId)
    pendingRef.current = remaining; setPending(remaining)
  }
  async function submit(record: PendingQueueRequest, retry = false): Promise<boolean> {
    if (locked.current || !ready) return false
    if (pendingRef.current && !retry) { setError('Resolve the unacknowledged queue request before sending another.'); return false }
    locked.current = true; setBusy(true); setError(''); setNotice('')
    try {
      await queueJournal(agentId, record)
      pendingRef.current = record; setPending(record)
      const response = await fetch(record.replacementId ? `${base}/${encodeURIComponent(record.replacementId)}` : base, {
        method: record.replacementId ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(record.input),
      })
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}))
        if (response.status >= 400 && response.status < 500) {
          await clearPending(record)
        }
        throw new Error(detail.error ?? 'Queue acknowledgement unavailable; retry this same request.')
      }
      const item: UserQueueItem = await response.json()
      await clearPending(record)
      setNotice(`Follow-up ${item.status}.`); setEditing(null)
      await refresh().catch(() => setError('Input acknowledged; queue display could not refresh.'))
      return true
    } catch (e) { setError(e instanceof Error ? e.message : 'Queue request failed'); return false }
    finally { locked.current = false; setBusy(false) }
  }
  async function action(path: string, body: unknown, method = 'POST'): Promise<boolean> {
    if (locked.current) return false
    locked.current = true; setBusy(true); setError('')
    try {
      const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) { const detail = await response.json(); throw new Error(detail.error ?? 'Queue changed; refresh and try again') }
      await refresh(); return true
    } catch (e) { setError(e instanceof Error ? e.message : 'Queue action failed'); await refresh().catch(() => {}); return false }
    finally { locked.current = false; setBusy(false) }
  }
  useImperativeHandle(ref, () => ({
    async enqueue(message, attachments, expectedSelection) {
      if (!expectedSelection) { setError('Refresh conversation history before queuing input.'); return false }
      return submit({ agentId, input: { requestId: crypto.randomUUID(), message, attachments, expectedSelection } })
    },
    async stop() {
      if (!state) { setError('Load queue controls before stopping.'); return false }
      return action('/stop', { expectedRevision: state.control.revision })
    },
  }))
  async function edit(item: UserQueueItem) {
    try {
      const response = await fetch(`${base}/${encodeURIComponent(item.id)}/input`)
      if (!response.ok) throw new Error('Retained input is unavailable')
      const input = await response.json() as { message: string; attachments: Attachment[] }
      setEditing(item); setText(input.message); setEditFiles(input.attachments)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not edit') }
  }
  return <section aria-label="Follow-up queue" className="max-h-[45%] shrink-0 overflow-y-auto border-t border-frost px-3 py-2 text-sm">
    <div className="flex flex-wrap items-center gap-2">
      <strong>Follow-ups {state?.control.paused ? '· Paused' : ''}</strong>
      {state && <Button variant="ghost" disabled={busy} onClick={() => void action('/control', { paused: !state.control.paused, expectedRevision: state.control.revision })}>{state.control.paused ? 'Resume queue' : 'Pause queue'}</Button>}
      {state && <Button variant="danger" disabled={busy} onClick={() => void action('/stop', { expectedRevision: state.control.revision })}>Stop and pause</Button>}
      <Button variant="ghost" onClick={() => { setHistory(!history); setOffset(0) }}>{history ? 'Pending' : 'History'}</Button>
    </div>
    {error && <p role="alert" className="text-danger">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {pending && <div role="status" className="my-2 rounded border border-frost p-2"><p>A queue request has no confirmed acknowledgement. Retrying uses the same request and files.</p><p className="truncate">{pending.input.message}</p><Button variant="primary" disabled={busy} onClick={() => void submit(pending, true)}>Retry saved request</Button></div>}
    <div className="max-h-48 overflow-y-auto">
      {state?.items.map(item => <article key={item.id} className="my-2 rounded border border-frost p-2">
        <div className="flex flex-wrap gap-2"><strong>{item.status}</strong><span>{item.source}</span><Button variant="ghost" onClick={() => onViewConversation(item.conversationId)}>View conversation</Button></div>
        <p className="whitespace-pre-wrap break-words">{item.text ?? 'Input retention expired'}</p>
        {item.attachments.map(file => <p key={file.id} className="break-all">{file.name ?? 'Attachment'} · {file.byteLength} bytes</p>)}
        {item.diagnostic && <p>{item.diagnostic}</p>}
        {item.approvalId && <a href={`/approvals`}>Review communication approval</a>}
        {item.status === 'pending' && <div className="flex gap-2"><Button variant="ghost" disabled={busy || !!pending} onClick={() => void edit(item)}>Edit</Button><Button variant="danger" disabled={busy} onClick={() => void action(`/${item.id}`, { expectedRevision: item.revision }, 'DELETE')}>Remove</Button></div>}
        {item.status === 'uncertain' && <div><p>This input may already have acted. Review its conversation before closing it. Closing never retries it.</p><Button variant="danger" disabled={busy} onClick={() => void action(`/${item.id}/reconcile`, { expectedRevision: item.revision, acknowledged: true })}>Acknowledge and close</Button></div>}
      </article>)}
      {editing && <form onSubmit={e => { e.preventDefault(); const expectedSelection = selection(); if (expectedSelection) void submit({ agentId, replacementId: editing.id, input: { requestId: crypto.randomUUID(), expectedRevision: editing.revision, expectedSelection, message: text, attachments: editFiles } }) }}>
        <label>Edit queued input<textarea aria-label="Edit queued input" className="w-full" value={text} onChange={e => setText(e.target.value)} /></label>
        {editFiles.map((file, index) => <div key={index}>{file.name ?? 'Attachment'} <Button variant="ghost" onClick={() => setEditFiles(files => files.filter((_, i) => i !== index))}>Remove attachment</Button></div>)}
        <Button variant="primary" type="submit" disabled={busy || !!pending}>Save replacement</Button><Button variant="ghost" onClick={() => setEditing(null)}>Cancel edit</Button>
      </form>}
    </div>
    {state && (offset > 0 || offset + state.items.length < state.total) && <div className="flex gap-2"><Button variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>Previous</Button><Button variant="ghost" disabled={offset + state.items.length >= state.total} onClick={() => setOffset(offset + 20)}>Next</Button></div>}
  </section>
})
