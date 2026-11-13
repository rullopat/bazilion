import type {
  Agent,
  Profile,
  ProviderMessage,
  ResolvedAgent,
  SessionHeadResponse,
  Team,
  TeamTemplate,
} from '@bazilion/api-types'
import { ApiClientError } from '@bazilion/client'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { ChatPane } from '../components/chat/ChatPane'
import { SIDEBAR_OPEN_GROUPS_COOKIE, Sidebar } from '../components/Sidebar'
import { daemonClient } from '../lib/daemon-client'

interface SelectedAgent {
  resolved: ResolvedAgent
  messages: ProviderMessage[]
  head: SessionHeadResponse
}

/** The sidebar's open/closed Teams; a bad cookie is ignored. */
function parseOpenGroupsCookie(raw: string | undefined): Record<string, boolean> {
  try {
    const parsed = JSON.parse(decodeURIComponent(raw ?? '{}')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, boolean] => {
        return typeof entry[1] === 'boolean'
      }),
    )
  } catch {
    return {}
  }
}

const fetchHome = createServerFn({ method: 'GET' })
  .validator((data: { agentId?: string }) => data)
  .handler(async ({ data }) => {
    const client = daemonClient()
    const [agents, profiles, teamTemplates, teams] = await Promise.all([
      client.get<Agent[]>('/api/agents?includeArchived=false'),
      client.get<Profile[]>('/api/profiles'),
      client.get<TeamTemplate[]>('/api/team-templates'),
      client.get<Team[]>('/api/teams'),
    ])
    let selected: SelectedAgent | null = null
    if (data.agentId) {
      try {
        const resolved = await client.get<ResolvedAgent>(
          `/api/agents/${encodeURIComponent(data.agentId)}`,
        )
        // Archived Agents are not in the sidebar, so a stale ?agent= link shows the empty pane.
        if (resolved.agent.status !== 'archived') {
          const history = await client.get<{
            messages: ProviderMessage[]
            head: SessionHeadResponse
          }>(`/api/agents/${encodeURIComponent(resolved.agent.id)}/sessions/messages`)
          selected = { resolved, messages: history.messages, head: history.head }
        }
      } catch (err) {
        // An unknown ?agent= id shows the empty pane; other failures surface.
        if (!(err instanceof ApiClientError) || err.status !== 404) throw err
      }
    }
    const openGroups = parseOpenGroupsCookie(getCookie(SIDEBAR_OPEN_GROUPS_COOKIE))
    return { agents, profiles, teamTemplates, teams, selected, openGroups }
  })

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): { agent?: string } => ({
    agent: typeof search.agent === 'string' ? search.agent : undefined,
  }),
  loaderDeps: ({ search }) => ({ agentId: search.agent }),
  loader: ({ deps }) => fetchHome({ data: { agentId: deps.agentId } }),
  component: HomePage,
})

function HomePage() {
  const { agents, profiles, teamTemplates, teams, selected, openGroups } = Route.useLoaderData()

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 py-3 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div className={`min-h-0 ${selected ? 'hidden lg:block' : ''}`}>
        <Sidebar
          agents={agents}
          teams={teams}
          profiles={profiles}
          teamTemplates={teamTemplates}
          selectedAgentId={selected?.resolved.agent.id ?? null}
          initialOpenGroups={openGroups}
        />
      </div>
      <section className={`min-h-0 overflow-hidden ${selected ? '' : 'hidden lg:block'}`}>
        {selected ? (
          <ChatPane
            agentId={selected.resolved.agent.id}
            agentName={selected.resolved.agent.name}
            initialMessages={selected.messages}
            initialSessionHead={selected.head}
          />
        ) : (
          <div className="flex h-full items-center justify-center rounded-2xl border border-dashed bg-card px-6 text-center text-muted-foreground">
            <div className="max-w-sm">
              <h1 className="m-0 font-body text-lg font-semibold text-foreground">
                {agents.length === 0 ? 'Start your first conversation' : 'Choose an agent'}
              </h1>
              <p className="mt-2 text-sm leading-6">
                {agents.length === 0
                  ? 'Your default Team and Agent template are ready. Use “Spawn first agent” on the left to create a working member.'
                  : 'Pick an agent in the Team list to open its persistent conversation.'}
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
