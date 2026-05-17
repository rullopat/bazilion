import { ApiClientError } from '@bazilion/client'
import type {
  Agent,
  Group,
  Profile,
  ProviderMessage,
  ResolvedAgent,
  SessionHeadResponse,
} from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { ChatPane } from '../components/ChatPane'
import { Sidebar } from '../components/Sidebar'
import { daemonClient } from '../lib/daemon-client'

interface SelectedView {
  resolved: ResolvedAgent
  initialMessages: ProviderMessage[]
  sessionHead: SessionHeadResponse
}

interface HomeData {
  agents: Agent[]
  profiles: Profile[]
  groups: Group[]
  selected: SelectedView | null
}

// POST so we can pass a typed input via `.inputValidator()`. The call site
// is server-internal so the HTTP verb is invisible to the user.
const fetchHomeData = createServerFn({ method: 'POST' })
  .inputValidator((d: { agentId?: string }) => d)
  .handler(async ({ data }): Promise<HomeData> => {
    const client = daemonClient()
    const [agents, profiles, groups] = await Promise.all([
      client.get<Agent[]>('/api/agents?includeArchived=false'),
      client.get<Profile[]>('/api/profiles'),
      client.get<Group[]>('/api/groups'),
    ])

    let selected: SelectedView | null = null
    if (data.agentId) {
      try {
        const resolved = await client.get<ResolvedAgent>(
          `/api/agents/${encodeURIComponent(data.agentId)}`,
        )
        const [msgs, head] = await Promise.all([
          client.get<{ messages: ProviderMessage[] }>(
            `/api/agents/${encodeURIComponent(resolved.agent.id)}/sessions/messages`,
          ),
          client.get<SessionHeadResponse>(
            `/api/agents/${encodeURIComponent(resolved.agent.id)}/sessions/head`,
          ),
        ])
        selected = {
          resolved,
          initialMessages: msgs.messages,
          sessionHead: head,
        }
      } catch (err) {
        // 404 = bad ?agent= id. Drop the selection silently and render the
        // empty pane; surface other errors so the user sees them.
        if (!(err instanceof ApiClientError) || err.status !== 404) throw err
      }
    }
    return { agents, profiles, groups, selected }
  })

export const Route = createFileRoute('/')({
  validateSearch: (s: Record<string, unknown>): { agent?: string } => ({
    agent: typeof s.agent === 'string' ? s.agent : undefined,
  }),
  loaderDeps: ({ search }) => ({ agentId: search.agent }),
  loader: ({ deps }) => fetchHomeData({ data: { agentId: deps.agentId } }),
  component: HomePage,
})

function HomePage() {
  const data = Route.useLoaderData()
  const selectedAgentId = data.selected?.resolved.agent.id ?? null

  return (
    <div className="grid h-full grid-cols-1 gap-3 py-3 sm:grid-cols-[16rem_minmax(0,1fr)]">
      <Sidebar
        agents={data.agents}
        groups={data.groups}
        profiles={data.profiles}
        selectedAgentId={selectedAgentId}
      />
      <main className="overflow-hidden">
        {data.selected ? (
          <ChatPane
            agentId={data.selected.resolved.agent.id}
            agentName={data.selected.resolved.agent.name}
            initialMessages={data.selected.initialMessages}
            initialSessionHead={data.selected.sessionHead}
          />
        ) : (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed bg-card text-muted-foreground">
            {data.agents.length === 0
              ? 'No agents yet.'
              : 'Pick an agent on the left to start chatting.'}
          </div>
        )}
      </main>
    </div>
  )
}
