// One Agent's mailbox: the messages other Agents sent it, a way to write to it as one of them,
// and the message chains that were stopped for going round in circles.

import type {
  Agent,
  AgentLoopBreakEvent,
  ListAgentLoopBreaksResponse,
  ListInboxResponse,
  Message,
  SendMessageRequest,
} from '@bazilion/api-types'
import { Inbox, OctagonX, Send } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { messageText as decodeText } from '../../lib/messages'
import { useHydrated, useResource } from '../../lib/use-resource'
import { AgentAvatar } from '../AgentAvatar'
import { Button } from '../Button'
import { Segmented } from '../Segmented'
import { SelectField, TextAreaField } from '../ui/form'
import {
  CardEmpty,
  CardForm,
  CardList,
  CardToolbar,
  Chip,
  ListRow,
  Notice,
  SetupCard,
} from '../ui/parts'

export function AgentMailbox({ agent, agents }: { agent: Agent; agents: Agent[] }) {
  const base = `/api/agents/${encodeURIComponent(agent.id)}`
  const data = useResource(
    async (signal) => {
      const [inbox, loopBreaks, everyone] = await Promise.all([
        api<ListInboxResponse>(`${base}/messages`, { signal }),
        api<ListAgentLoopBreaksResponse>(`${base}/loop-breaks?limit=10`, { signal }),
        // Archived Agents too: mail they sent still says who they are.
        api<Agent[]>('/api/agents?includeArchived=true', { signal }).catch(() => agents),
      ])
      // The daemon lists oldest first; the mailbox shows the newest on top.
      return {
        messages: [...inbox.messages].reverse(),
        loopBreaks: loopBreaks.events,
        agents: everyone,
      }
    },
    [base],
  )
  if (!data.data) {
    return data.error ? (
      <Notice role="alert" title="The mailbox could not be loaded.">
        {data.error}
      </Notice>
    ) : (
      <p role="status" className="m-0 text-sm text-muted-foreground">
        Loading the mailbox…
      </p>
    )
  }
  return <MailboxView agent={agent} {...data.data} onChanged={data.reload} />
}

type Known = Pick<Agent, 'id' | 'name' | 'status'> & Partial<Pick<Agent, 'identity'>>

/** An Agent's name; two Agents with one name get the start of their id as well. */
export function agentNamer(agents: readonly Known[]): (id: string) => string {
  const byId = new Map(agents.map((entry) => [entry.id, entry]))
  const count = new Map<string, number>()
  for (const entry of agents) count.set(entry.name, (count.get(entry.name) ?? 0) + 1)
  return (id) => {
    const known = byId.get(id)
    if (!known) return 'A deleted Agent'
    const name = (count.get(known.name) ?? 0) > 1 ? `${known.name} (${id.slice(0, 8)})` : known.name
    return known.status === 'archived' ? `${name} (archived)` : name
  }
}

/** Who a message can be written as: the other Agents that are not archived. */
export function mailSenders(
  agentId: string,
  agents: readonly Known[],
): { value: string; label: string }[] {
  const nameOf = agentNamer(agents)
  return agents
    .filter((entry) => entry.status !== 'archived' && entry.id !== agentId)
    .map((entry) => ({ value: entry.id, label: nameOf(entry.id) }))
}

/** The mailbox as loaded: the messages, the form to write one, the stopped chains. */
export function MailboxView({
  agent,
  agents,
  messages: all,
  loopBreaks,
  onChanged,
}: {
  agent: Pick<Agent, 'id' | 'name'>
  agents: Known[]
  /** Newest first. */
  messages: Message[]
  loopBreaks: AgentLoopBreakEvent[]
  onChanged: () => Promise<void>
}) {
  const [show, setShow] = useState<'all' | 'unread'>('all')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [markError, setMarkError] = useState<string | null>(null)
  const hydrated = useHydrated()
  const when = (at: number) => (hydrated ? new Date(at).toLocaleString() : '')
  const unread = all.filter((message) => message.readAt === null)
  const messages = show === 'unread' ? unread : all
  const byId = new Map(agents.map((entry) => [entry.id, entry]))
  const nameOf = agentNamer(agents)
  const senders = mailSenders(agent.id, agents)

  async function markRead(message: Message) {
    setBusyId(message.id)
    setMarkError(null)
    try {
      await api(`/api/messages/${encodeURIComponent(message.id)}`, {
        method: 'PATCH',
        body: { read: true },
      })
      await onChanged()
    } catch (cause) {
      setMarkError(errorMessage(cause))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="grid gap-5">
      <SetupCard
        labelledBy="agent-mailbox"
        icon={<Inbox className="size-5" />}
        title="Messages"
        description={`What other Agents sent ${agent.name}. It reads the unread ones when it is next free.`}
        action={
          unread.length > 0 ? (
            <Chip tone="warning">{unread.length} unread</Chip>
          ) : (
            <Chip tone="neutral">0 unread</Chip>
          )
        }
      >
        {all.length > 0 && (
          <CardToolbar>
            <Segmented
              label="Which messages"
              value={show}
              onChange={setShow}
              options={[
                { id: 'all', label: `All ${all.length}` },
                { id: 'unread', label: `Unread ${unread.length}` },
              ]}
            />
          </CardToolbar>
        )}
        {markError && (
          <div className="border-t border-border px-4 py-3 sm:px-5">
            <Notice role="alert" title="It could not be marked read.">
              {markError}
            </Notice>
          </div>
        )}
        {messages.length === 0 ? (
          <CardEmpty
            icon={<Inbox className="size-5" />}
            title={all.length === 0 ? 'No messages yet' : 'Nothing unread'}
          >
            {all.length === 0 && 'Teammates write here with their messaging tool.'}
          </CardEmpty>
        ) : (
          <CardList>
            {messages.map((message) => {
              const from = byId.get(message.fromAgentId)
              const isUnread = message.readAt === null
              return (
                <ListRow
                  key={message.id}
                  inline
                  leading={<AgentAvatar identity={from?.identity} size={32} />}
                  title={`From ${nameOf(message.fromAgentId)}`}
                  chip={isUnread && <Chip tone="warning">Unread</Chip>}
                  meta={
                    <>
                      <span>{when(message.createdAt)}</span>
                      {message.replyTo && <span>A reply</span>}
                    </>
                  }
                  actions={
                    isUnread && (
                      <Button
                        variant="ghost"
                        disabled={busyId === message.id}
                        aria-label={`Mark the message from ${nameOf(message.fromAgentId)} read`}
                        onClick={() => void markRead(message)}
                      >
                        Mark read
                      </Button>
                    )
                  }
                >
                  <p className="m-0 whitespace-pre-wrap break-words rounded-xl bg-muted/50 px-3 py-2 text-sm text-foreground">
                    {decodeText(message.payload)}
                  </p>
                </ListRow>
              )
            })}
          </CardList>
        )}
      </SetupCard>

      {senders.length > 0 && (
        <SendMessage agent={agent} senders={senders} onSent={() => void onChanged()} />
      )}

      <SetupCard
        labelledBy="agent-loop-breaks"
        icon={<OctagonX className="size-5" />}
        title="Stopped chains"
        description="When Agents keep answering each other past the limit, the chain stops and shows here."
      >
        {loopBreaks.length === 0 ? (
          <CardEmpty title="No chain has been stopped" />
        ) : (
          <CardList>
            {loopBreaks.map((event) => (
              <ListRow
                key={event.id}
                inline
                title={`${nameOf(event.fromAgentId)} → ${nameOf(event.toAgentId)}`}
                meta={
                  <>
                    <span>
                      Stopped at message {event.attemptedHop}; the limit is {event.maxHops}
                    </span>
                    <span>{when(event.createdAt)}</span>
                  </>
                }
              />
            ))}
          </CardList>
        )}
      </SetupCard>
    </div>
  )
}

function SendMessage({
  agent,
  senders,
  onSent,
}: {
  agent: Pick<Agent, 'id' | 'name'>
  senders: { value: string; label: string }[]
  onSent: () => void
}) {
  const [from, setFrom] = useState(senders[0]?.value ?? '')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!text.trim()) return
    setError(null)
    setSubmitting(true)
    try {
      const body: SendMessageRequest = { from, payload: { text } }
      await api(`/api/agents/${encodeURIComponent(agent.id)}/messages`, { body })
      setText('')
      setSent(true)
      onSent()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <SetupCard
      labelledBy="agent-mailbox-send"
      icon={<Send className="size-5" />}
      title="Send a message to this Agent"
      description={`Write to ${agent.name} as one of its teammates, to see how it handles mail.`}
    >
      <CardForm onSubmit={(event) => void submit(event)}>
        <SelectField
          label="From"
          value={from}
          options={senders}
          disabled={submitting}
          onChange={setFrom}
        />
        <TextAreaField
          label="Message"
          value={text}
          rows={3}
          disabled={submitting}
          onChange={(value) => {
            setText(value)
            setSent(false)
          }}
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button variant="primary" type="submit" disabled={submitting || !text.trim()}>
            {submitting ? 'Sending…' : 'Send'}
          </Button>
          <p
            role="status"
            className={`m-0 text-sm font-medium ${error ? 'text-warning' : 'text-success'}`}
          >
            {error
              ? `Not sent: ${error}`
              : sent
                ? `Sent. ${agent.name} reads it when it is free.`
                : ''}
          </p>
        </div>
      </CardForm>
    </SetupCard>
  )
}
