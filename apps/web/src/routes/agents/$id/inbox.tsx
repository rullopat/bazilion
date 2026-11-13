import type {
  Agent,
  ListAgentLoopBreaksResponse,
  ListInboxResponse,
  Message,
  SendMessageRequest,
} from '@bazilion/api-types'
import { ApiClientError } from '@bazilion/client'
import { createFileRoute, getRouteApi, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { Button } from '../../../components/Button'
import { api, errorMessage } from '../../../lib/api'
import { daemonClient } from '../../../lib/daemon-client'

const agentRoute = getRouteApi('/agents/$id')

const fetchInbox = createServerFn({ method: 'GET' })
  .validator((data: { id: string; unreadOnly: boolean; selectedId: string }) => data)
  .handler(async ({ data }) => {
    const client = daemonClient()
    const agent = `/api/agents/${encodeURIComponent(data.id)}`
    const [list, unread, agents, loopBreaks] = await Promise.all([
      client.get<ListInboxResponse>(`${agent}/messages${data.unreadOnly ? '?unread=1' : ''}`),
      client.get<ListInboxResponse>(`${agent}/messages?unread=1`),
      client.get<Agent[]>('/api/agents?includeArchived=true'),
      client.get<ListAgentLoopBreaksResponse>(`${agent}/loop-breaks?limit=10`),
    ])
    let selected: Message | null = null
    if (data.selectedId) {
      try {
        selected = await client.get<Message>(`/api/messages/${encodeURIComponent(data.selectedId)}`)
      } catch (error) {
        if (!(error instanceof ApiClientError) || error.status !== 404) throw error
      }
    }
    return {
      messages: [...list.messages].reverse(),
      unreadCount: unread.messages.length,
      selected,
      agentNames: Object.fromEntries(agents.map((a) => [a.id, a.name])) as Record<string, string>,
      senders: agents
        .filter((a) => a.status !== 'archived' && a.id !== data.id)
        .map((a) => ({ id: a.id, name: a.name })),
      loopBreaks: loopBreaks.events,
    }
  })

export const Route = createFileRoute('/agents/$id/inbox')({
  // The router parses `?unread=1` into the number 1 (and would rewrite a string '1' as `"1"`).
  validateSearch: (search: Record<string, unknown>): { unread?: 1; id?: string } => ({
    unread: search.unread === 1 ? 1 : undefined,
    id: typeof search.id === 'string' ? search.id : undefined,
  }),
  loaderDeps: ({ search }) => ({ unreadOnly: search.unread === 1, selectedId: search.id ?? '' }),
  loader: ({ params, deps }) => fetchInbox({ data: { id: params.id, ...deps } }),
  component: InboxPage,
})

function decodeText(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as { text?: unknown }
    if (typeof parsed.text === 'string') return parsed.text
  } catch {
    // Not JSON: shown as is.
  }
  return payload
}

function InboxPage() {
  const { agent } = agentRoute.useLoaderData()
  const { messages, unreadCount, selected, agentNames, senders, loopBreaks } = Route.useLoaderData()
  const router = useRouter()
  const [markError, setMarkError] = useState<string | null>(null)
  const unreadOnly = Route.useSearch().unread === 1
  const misaddressed = Boolean(selected && selected.toAgentId !== agent.id)
  const inbox = `/agents/${encodeURIComponent(agent.id)}/inbox`
  const label = (id: string) =>
    agentNames[id] ? `${agentNames[id]} (${id.slice(0, 8)})` : id.slice(0, 8)
  const filterClass = (active: boolean) =>
    `-mb-px border-b-2 px-3 py-1.5 text-sm ${active ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted-foreground'}`

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[360px_1fr]">
      <div>
        <div className="mb-3 flex items-center gap-1 border-b">
          <a href={inbox} className={filterClass(!unreadOnly)}>
            all
          </a>
          <a href={`${inbox}?unread=1`} className={filterClass(unreadOnly)}>
            unread
          </a>
          <span className="ml-auto text-xs text-muted-foreground">unread: {unreadCount}</span>
        </div>
        <div className="max-h-[640px] overflow-y-auto rounded-lg border bg-card">
          {messages.length === 0 ? (
            <div className="p-6 text-center italic text-muted-foreground">
              {unreadOnly ? 'no unread messages' : 'inbox empty'}
            </div>
          ) : (
            messages.map((message) => {
              const text = decodeText(message.payload)
              const unread = message.readAt === null
              const query = unreadOnly ? `?unread=1&id=${message.id}` : `?id=${message.id}`
              return (
                <a
                  key={message.id}
                  href={`${inbox}${query}`}
                  className={`block border-b px-3 py-2 text-sm last:border-0 hover:bg-accent/30 ${
                    selected?.id === message.id ? 'bg-accent/40' : ''
                  } ${unread ? 'font-medium' : ''}`}
                >
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span className="font-mono">
                      {unread && (
                        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle" />
                      )}
                      from {label(message.fromAgentId)}
                    </span>
                    <span className="font-mono">
                      {new Date(message.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-foreground">
                    {text.length > 80 ? `${text.slice(0, 80)}…` : text}
                  </div>
                </a>
              )
            })
          )}
        </div>
      </div>

      <div>
        {selected && !misaddressed && (
          <div className="mb-4 rounded-lg border bg-card p-5">
            <div className="mb-2 space-y-0.5 font-mono text-xs text-muted-foreground">
              <div>
                id: <code>{selected.id}</code>
              </div>
              <div>
                from: <code>{label(selected.fromAgentId)}</code>
              </div>
              <div>received: {new Date(selected.createdAt).toLocaleString()}</div>
              <div>
                read: {selected.readAt ? new Date(selected.readAt).toLocaleString() : '(unread)'}
                {!selected.readAt && (
                  <Button
                    variant="ghost"
                    className="ml-2"
                    onClick={async () => {
                      setMarkError(null)
                      try {
                        await api(`/api/messages/${encodeURIComponent(selected.id)}`, {
                          method: 'PATCH',
                          body: { read: true },
                        })
                        await router.invalidate()
                      } catch (cause) {
                        setMarkError(errorMessage(cause))
                      }
                    }}
                  >
                    Mark read
                  </Button>
                )}
                {markError && (
                  <span role="alert" className="ml-2 text-danger">
                    {markError}
                  </span>
                )}
              </div>
              {selected.replyTo && (
                <div>
                  reply to: <code>{selected.replyTo}</code>
                </div>
              )}
            </div>
            <div className="whitespace-pre-wrap break-words border-t pt-3 font-mono text-sm">
              {decodeText(selected.payload)}
            </div>
          </div>
        )}
        {misaddressed && (
          <div className="mb-4 rounded-lg border bg-card p-5 text-muted-foreground">
            This message is not addressed to this Agent.
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Agents exchange messages with their <code className="font-mono">send_message</code> tool;
          an idle recipient picks up unread mail on the next scheduler tick.
        </p>
        <SendMessageForm agentId={agent.id} senders={senders} onSent={() => router.invalidate()} />
        <div className="mt-6 rounded-lg border bg-card p-4">
          <h2 className="mb-2 font-serif text-lg text-foreground">Loop circuit breaker</h2>
          {loopBreaks.length === 0 ? (
            <p className="text-xs text-muted-foreground">No agent-message chains stopped.</p>
          ) : (
            <div className="space-y-3">
              {loopBreaks.map((event) => (
                <div key={event.id} className="border-t pt-3 text-xs first:border-0 first:pt-0">
                  <div className="font-mono text-foreground">
                    {label(event.fromAgentId)} → {label(event.toAgentId)}
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    stopped hop {event.attemptedHop} at limit {event.maxHops} · chain{' '}
                    <code>{event.causalChainId.slice(0, 8)}</code> ·{' '}
                    {new Date(event.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SendMessageForm({
  agentId,
  senders,
  onSent,
}: {
  agentId: string
  senders: { id: string; name: string }[]
  onSent: () => void
}) {
  const [from, setFrom] = useState(senders[0]?.id ?? '')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  if (senders.length === 0) return null

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const body: SendMessageRequest = { from, payload: { text } }
      await api(`/api/agents/${encodeURIComponent(agentId)}/messages`, { body })
      setText('')
      onSent()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="mt-6 rounded-lg border bg-card p-4">
      <h2 className="mb-2 font-serif text-lg text-foreground">Send a message to this Agent</h2>
      <label>
        From
        <select value={from} onChange={(event) => setFrom(event.target.value)}>
          {senders.map((sender) => (
            <option key={sender.id} value={sender.id}>
              {sender.name} ({sender.id.slice(0, 8)})
            </option>
          ))}
        </select>
      </label>
      <label>
        Message
        <textarea
          required
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="min-h-[80px] font-mono text-[0.9em]"
        />
      </label>
      <div className="mt-3 flex items-center gap-3">
        <Button variant="primary" type="submit" disabled={submitting}>
          {submitting ? 'Sending…' : 'Send'}
        </Button>
        {error && (
          <span role="alert" className="text-[0.85em] text-danger">
            {error}
          </span>
        )}
      </div>
    </form>
  )
}
