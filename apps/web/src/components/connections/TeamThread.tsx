// What a Team's Agents said to each other, newest first: the thread behind the hand-offs.

import type { ListTeamMessagesResponse, Message } from '@bazilion/api-types'
import { ArrowRight } from 'lucide-react'
import { shortTime, useActivity } from '../../lib/activity'
import { api } from '../../lib/api'
import { messageText } from '../../lib/messages'
import { type Resource, useHydrated, useResource } from '../../lib/use-resource'
import { AgentAvatar } from '../AgentAvatar'
import { useWorkspace } from '../workspace/context'

/** The Team's recent messages; loaded again whenever a turn ends. */
export function useTeamMessages(teamId: string, limit = 100): Resource<Message[]> {
  const { turnsEnded } = useActivity()
  return useResource(
    (signal) =>
      api<ListTeamMessagesResponse>(
        `/api/teams/${encodeURIComponent(teamId)}/messages?limit=${limit}`,
        { signal },
      ).then((body) => body.messages),
    [teamId, limit, turnsEnded],
  )
}

export function TeamThread({
  messages,
  limit = 20,
  empty = 'No messages between Agents yet.',
}: {
  messages: readonly Message[]
  limit?: number
  empty?: string
}) {
  const { agentById } = useWorkspace()
  const hydrated = useHydrated()
  if (messages.length === 0) {
    return <p className="m-0 py-3 text-sm text-muted-foreground">{empty}</p>
  }
  const name = (id: string) => agentById(id)?.name ?? id.slice(0, 8)
  return (
    <ol className="m-0 list-none space-y-1.5 p-0">
      {messages.slice(0, limit).map((message) => {
        const text = messageText(message.payload)
        return (
          <li key={message.id}>
            <details className="group rounded-[10px] border border-border bg-card">
              <summary className="flex cursor-pointer list-none flex-col gap-0.5 px-2.5 py-2 [&::-webkit-details-marker]:hidden">
                <span className="flex min-w-0 items-center gap-1.5 text-xs">
                  <AgentAvatar identity={agentById(message.fromAgentId)?.identity} size={18} />
                  <span className="min-w-0 truncate font-semibold text-foreground">
                    {name(message.fromAgentId)}
                  </span>
                  <ArrowRight
                    className="size-3 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <AgentAvatar identity={agentById(message.toAgentId)?.identity} size={18} />
                  <span className="min-w-0 truncate font-semibold text-foreground">
                    {name(message.toAgentId)}
                  </span>
                  {message.readAt === null && (
                    <span className="shrink-0 rounded-full bg-warning/15 px-1.5 text-xs font-semibold text-warning">
                      unread
                    </span>
                  )}
                  {hydrated && (
                    <time
                      dateTime={new Date(message.createdAt).toISOString()}
                      className="ml-auto shrink-0 text-muted-foreground"
                    >
                      {shortTime(message.createdAt)}
                    </time>
                  )}
                </span>
                <span className="line-clamp-2 break-words text-sm leading-snug text-mocha group-open:hidden">
                  {text}
                </span>
              </summary>
              <p className="m-0 whitespace-pre-wrap break-words border-t border-frost/70 px-2.5 py-2 text-sm leading-snug text-chocolate">
                {text}
              </p>
            </details>
          </li>
        )
      })}
      {messages.length > limit && (
        <li className="px-1 text-xs text-muted-foreground">
          The newest {limit} of {messages.length} loaded.
        </li>
      )}
    </ol>
  )
}
