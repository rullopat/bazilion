// One Agent's mailbox: the messages other Agents sent it, a way to send it one on another
// Agent's behalf, and the message chains the loop limit stopped.

import type {
  Agent,
  AgentLoopBreakEvent,
  ListAgentLoopBreaksResponse,
  ListInboxResponse,
  Message,
  SendMessageRequest,
} from '@bazilion/api-types'
import { useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { messageText as decodeText } from '../../lib/messages'
import { useResource } from '../../lib/use-resource'
import { Button } from '../Button'

export function AgentMailbox({ agent, agents }: { agent: Agent; agents: Agent[] }) {
  const base = `/api/agents/${encodeURIComponent(agent.id)}`
  const data = useResource(
    async (signal) => {
      const [inbox, loopBreaks] = await Promise.all([
        api<ListInboxResponse>(`${base}/messages`, { signal }),
        api<ListAgentLoopBreaksResponse>(`${base}/loop-breaks?limit=10`, { signal }),
      ])
      // The daemon lists oldest first; the mailbox shows the newest on top.
      return { messages: [...inbox.messages].reverse(), loopBreaks: loopBreaks.events }
    },
    [base],
  )
  if (!data.data) {
    return data.error ? (
      <p role="alert" className="err">
        {data.error}
      </p>
    ) : (
      <p role="status" className="muted">
        Loading the mailbox…
      </p>
    )
  }
  return <MailboxView agent={agent} agents={agents} {...data.data} onChanged={data.reload} />
}

/** The mailbox as loaded: the list, the open message, the send form and the stopped chains. */
export function MailboxView({
  agent,
  agents,
  messages: all,
  loopBreaks,
  onChanged,
}: {
  agent: Pick<Agent, 'id' | 'name'>
  agents: Array<Pick<Agent, 'id' | 'name' | 'status'>>
  /** Newest first. */
  messages: Message[]
  loopBreaks: AgentLoopBreakEvent[]
  onChanged: () => Promise<void>
}) {
  const [unreadOnly, setUnreadOnly] = useState(false)
  // The newest unread message is open when the mailbox opens.
  const [selectedId, setSelectedId] = useState<string | null>(
    () => all.find((message) => message.readAt === null)?.id ?? null,
  )
  const [markError, setMarkError] = useState<string | null>(null)
  const unreadCount = all.filter((message) => message.readAt === null).length
  const messages = unreadOnly ? all.filter((message) => message.readAt === null) : all
  const selected: Message | null = all.find((message) => message.id === selectedId) ?? null
  const agentNames = Object.fromEntries(agents.map((entry) => [entry.id, entry.name]))
  const senders = agents
    .filter((entry) => entry.status !== 'archived' && entry.id !== agent.id)
    .map((entry) => ({ id: entry.id, name: entry.name }))
  const label = (id: string) =>
    agentNames[id] ? `${agentNames[id]} (${id.slice(0, 8)})` : id.slice(0, 8)
  const filterClass = (active: boolean) =>
    `unstyled -mb-px border-b-2 px-3 py-1.5 text-sm ${active ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted-foreground'}`

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[360px_1fr]">
      <div>
        <div className="mb-3 flex items-center gap-1 border-b">
          <button
            type="button"
            aria-pressed={!unreadOnly}
            onClick={() => setUnreadOnly(false)}
            className={filterClass(!unreadOnly)}
          >
            All
          </button>
          <button
            type="button"
            aria-pressed={unreadOnly}
            onClick={() => setUnreadOnly(true)}
            className={filterClass(unreadOnly)}
          >
            Unread
          </button>
          <span className="ml-auto text-xs text-muted-foreground">{unreadCount} unread</span>
        </div>
        <div className="max-h-[60dvh] overflow-y-auto rounded-lg border bg-card">
          {messages.length === 0 ? (
            <div className="p-6 text-center italic text-muted-foreground">
              {unreadOnly ? 'Nothing unread.' : 'No messages yet.'}
            </div>
          ) : (
            messages.map((message) => {
              const text = decodeText(message.payload)
              const unread = message.readAt === null
              return (
                <button
                  type="button"
                  key={message.id}
                  onClick={() => {
                    setMarkError(null)
                    setSelectedId(message.id)
                  }}
                  className={`unstyled block w-full border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-accent/30 ${
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
                </button>
              )
            })
          )}
        </div>
      </div>

      <div>
        {selected && (
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
                        await onChanged()
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
        <p className="text-xs text-muted-foreground">
          Agents exchange messages with their <code className="font-mono">send_message</code> tool;
          an idle recipient picks up unread mail on the next scheduler tick.
        </p>
        <SendMessageForm agentId={agent.id} senders={senders} onSent={() => void onChanged()} />
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
