import { ApiClientError } from '@bazilion/client'
import type {
  Agent,
  AgentLoopBreakEvent,
  ListAgentLoopBreaksResponse,
  ListInboxResponse,
  Message,
  ResolvedAgent,
} from '@bazilion/api-types'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { AgentTabs } from '../../../components/AgentTabs'
import { PageShell } from '../../../components/Page'
import { daemonClient } from '../../../lib/daemon-client'

interface InboxView {
  resolved: ResolvedAgent
  messages: Message[]
  unreadCount: number
  selected: Message | null
  agentNames: Record<string, string>
  loopBreaks: AgentLoopBreakEvent[]
}

const fetchInbox = createServerFn({ method: 'POST' })
  .validator((d: { id: string; unreadOnly: boolean; selectedId: string }) => d)
  .handler(async ({ data }): Promise<InboxView | null> => {
    const c = daemonClient()
    let resolved: ResolvedAgent
    try {
      resolved = await c.get<ResolvedAgent>(`/api/agents/${encodeURIComponent(data.id)}`)
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 404) return null
      throw err
    }
    const inboxQs = data.unreadOnly ? '?unread=1' : ''
    const [list, unread, allAgents, loopBreaks] = await Promise.all([
      c.get<ListInboxResponse>(
        `/api/agents/${encodeURIComponent(resolved.agent.id)}/messages${inboxQs}`,
      ),
      c.get<ListInboxResponse>(
        `/api/agents/${encodeURIComponent(resolved.agent.id)}/messages?unread=1`,
      ),
      c.get<Agent[]>('/api/agents?includeArchived=true'),
      c.get<ListAgentLoopBreaksResponse>(
        `/api/agents/${encodeURIComponent(resolved.agent.id)}/loop-breaks?limit=10`,
      ),
    ])
    let selected: Message | null = null
    if (data.selectedId) {
      try {
        selected = await c.get<Message>(`/api/messages/${encodeURIComponent(data.selectedId)}`)
      } catch (err) {
        if (!(err instanceof ApiClientError) || err.status !== 404) throw err
      }
    }
    const agentNames: Record<string, string> = {}
    for (const a of allAgents) agentNames[a.id] = a.name
    return {
      resolved,
      messages: [...list.messages].reverse(),
      unreadCount: unread.messages.length,
      selected,
      agentNames,
      loopBreaks: loopBreaks.events,
    }
  })

export const Route = createFileRoute('/agents/$id/inbox')({
  validateSearch: (s: Record<string, unknown>): { unread?: '1'; id?: string } => ({
    unread: s.unread === '1' ? '1' : undefined,
    id: typeof s.id === 'string' ? s.id : undefined,
  }),
  loaderDeps: ({ search }) => ({
    unreadOnly: search.unread === '1',
    selectedId: search.id ?? '',
  }),
  loader: async ({ params, deps }) => {
    const data = await fetchInbox({ data: { id: params.id, ...deps } })
    if (!data) throw redirect({ to: '/agents' })
    return data
  },
  component: InboxPage,
})

function decodeText(payload: string): string {
  try {
    const obj = JSON.parse(payload) as { text?: unknown }
    if (typeof obj.text === 'string') return obj.text
  } catch {}
  return payload
}

function InboxPage() {
  const { resolved, messages, unreadCount, selected, agentNames, loopBreaks } =
    Route.useLoaderData()
  const search = Route.useSearch()
  const unreadOnly = search.unread === '1'
  const misaddressed = Boolean(selected && selected.toAgentId !== resolved.agent.id)

  function agentLabel(aid: string): string {
    const name = agentNames[aid]
    return name ? `${name} (${aid.slice(0, 8)})` : aid.slice(0, 8)
  }

  return (
    <PageShell>
      <h1 className="font-serif text-3xl text-foreground mb-1">{resolved.agent.name}</h1>
      <p className="text-xs text-muted-foreground mb-6">
        <code className="font-mono">{resolved.agent.id.slice(0, 8)}…</code> · unread: {unreadCount}
      </p>
      <AgentTabs
        agentId={resolved.agent.id}
        active="inbox"
        archived={resolved.agent.status === 'archived'}
      />

      <div className="grid grid-cols-1 md:grid-cols-[360px_1fr] gap-6">
        <div>
          <div className="flex gap-1 border-b mb-3">
            <a
              href={`/agents/${resolved.agent.id}/inbox`}
              className={`px-3 py-1.5 text-sm border-b-2 -mb-px ${
                !unreadOnly
                  ? 'border-primary text-primary font-semibold'
                  : 'border-transparent text-muted-foreground'
              }`}
            >
              all
            </a>
            <a
              href={`/agents/${resolved.agent.id}/inbox?unread=1`}
              className={`px-3 py-1.5 text-sm border-b-2 -mb-px ${
                unreadOnly
                  ? 'border-primary text-primary font-semibold'
                  : 'border-transparent text-muted-foreground'
              }`}
            >
              unread
            </a>
          </div>
          <div className="rounded-lg border bg-card max-h-[640px] overflow-y-auto">
            {messages.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground italic">
                {unreadOnly ? 'no unread messages' : 'inbox empty'}
              </div>
            ) : (
              messages.map((m) => {
                const text = decodeText(m.payload)
                const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text
                const when = new Date(m.createdAt).toLocaleString()
                const isActive = selected?.id === m.id
                const isUnread = m.readAt === null
                const qs = unreadOnly ? `?unread=1&id=${m.id}` : `?id=${m.id}`
                return (
                  <a
                    key={m.id}
                    href={`/agents/${resolved.agent.id}/inbox${qs}`}
                    className={`block border-b last:border-0 px-3 py-2 text-sm hover:bg-accent/30 ${
                      isActive ? 'bg-accent/40' : ''
                    } ${isUnread ? 'font-medium' : ''}`}
                  >
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span className="font-mono">
                        {isUnread && (
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mr-1.5 align-middle" />
                        )}
                        from {agentLabel(m.fromAgentId)}
                      </span>
                      <span className="font-mono">{when}</span>
                    </div>
                    <div className="text-foreground mt-0.5 truncate">{preview}</div>
                  </a>
                )
              })
            )}
          </div>
        </div>

        <div>
          {selected && !misaddressed && (
            <div className="rounded-lg border bg-card p-5 mb-4">
              <div className="font-mono text-xs text-muted-foreground mb-2 space-y-0.5">
                <div>id: <code>{selected.id}</code></div>
                <div>from: <code>{agentLabel(selected.fromAgentId)}</code></div>
                <div>received: {new Date(selected.createdAt).toLocaleString()}</div>
                <div>
                  read:{' '}
                  {selected.readAt ? new Date(selected.readAt).toLocaleString() : '(unread)'}
                </div>
                {selected.replyTo && (
                  <div>
                    reply to: <code>{selected.replyTo}</code>
                  </div>
                )}
              </div>
              <div className="border-t pt-3 font-mono text-sm whitespace-pre-wrap break-words">
                {decodeText(selected.payload)}
              </div>
            </div>
          )}
          {misaddressed && (
            <div className="rounded-lg border bg-card p-5 mb-4 text-muted-foreground">
              message is not addressed to this agent
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Agents exchange messages automatically via their{' '}
            <code className="font-mono">send_message</code> tool. An idle recipient's scheduler
            tick drains unread mail.
          </p>
          <div className="mt-6 rounded-lg border bg-card p-4">
            <h2 className="mb-2 font-serif text-lg text-foreground">Loop circuit breaker</h2>
            {loopBreaks.length === 0 ? (
              <p className="text-xs text-muted-foreground">No agent-message chains stopped.</p>
            ) : (
              <div className="space-y-3">
                {loopBreaks.map((event) => (
                  <div key={event.id} className="border-t first:border-0 first:pt-0 pt-3 text-xs">
                    <div className="font-mono text-foreground">
                      {agentLabel(event.fromAgentId)} → {agentLabel(event.toAgentId)}
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
    </PageShell>
  )
}
