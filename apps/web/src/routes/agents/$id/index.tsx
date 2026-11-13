import type { SessionMessagesResponse } from '@bazilion/api-types'
import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { ChatPane } from '../../../components/chat/ChatPane'
import { daemonClient } from '../../../lib/daemon-client'

const agentRoute = getRouteApi('/agents/$id')

const fetchHistory = createServerFn({ method: 'GET' })
  .validator((data: { id: string }) => data)
  .handler(({ data }) =>
    daemonClient().get<SessionMessagesResponse>(
      `/api/agents/${encodeURIComponent(data.id)}/sessions/messages`,
    ),
  )

export const Route = createFileRoute('/agents/$id/')({
  validateSearch: (search: Record<string, unknown>): { conversation?: string } =>
    typeof search.conversation === 'string' ? { conversation: search.conversation } : {},
  loader: ({ params }) => fetchHistory({ data: { id: params.id } }),
  component: AgentChatPage,
})

function AgentChatPage() {
  const { agent } = agentRoute.useLoaderData()
  const { messages, head } = Route.useLoaderData()
  const { conversation } = Route.useSearch()
  return (
    <div className="h-[70vh]">
      <ChatPane
        agentId={agent.id}
        agentName={agent.name}
        initialMessages={messages}
        initialSessionHead={head}
        openConversationId={conversation}
      />
    </div>
  )
}
