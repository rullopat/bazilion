import { ApiClientError } from '@bazilion/client'
import type {
  Agent,
  Group,
  Profile,
  HarnessTemplateWithCount,
  ProviderMessage,
  ResolvedAgent,
  SessionHeadResponse,
} from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { ChatPane } from '../components/ChatPane'
import { Sidebar, SIDEBAR_OPEN_GROUPS_COOKIE } from '../components/Sidebar'
import { daemonClient } from '../lib/daemon-client'

interface SelectedView {
  resolved: ResolvedAgent
  initialMessages: ProviderMessage[]
  sessionHead: SessionHeadResponse
}

interface HomeData {
  agents: Agent[]
  profiles: Profile[]
  profileGroups: HarnessTemplateWithCount[]
  groups: Group[]
  selected: SelectedView | null
  initialOpenGroups: Record<string, boolean>
}

// Pure parser so the rule lives next to the cookie name. getCookie may or may
// not URL-decode depending on the harness; handle either form defensively.
function parseOpenGroupsCookie(raw: string | undefined | null): Record<string, boolean> {
  if (!raw) return {}
  try {
    const decoded = raw.includes('%') ? decodeURIComponent(raw) : raw
    const parsed = JSON.parse(decoded) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, boolean> = {}
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'boolean') out[k] = v
      }
      return out
    }
  } catch {
    // bad cookie value — fall through to {}
  }
  return {}
}

// POST so we can pass a typed input via `.inputValidator()`. The call site
// is server-internal so the HTTP verb is invisible to the user.
const fetchHomeData = createServerFn({ method: 'POST' })
  .inputValidator((d: { agentId?: string }) => d)
  .handler(async ({ data }): Promise<HomeData> => {
    const client = daemonClient()
    const [agents, profiles, profileGroups, groups] = await Promise.all([
      client.get<Agent[]>('/api/agents?includeArchived=false'),
      client.get<Profile[]>('/api/profiles'),
      client.get<HarnessTemplateWithCount[]>('/api/harness-templates'),
      client.get<Group[]>('/api/groups'),
    ])

    const initialOpenGroups = parseOpenGroupsCookie(getCookie(SIDEBAR_OPEN_GROUPS_COOKIE))

    let selected: SelectedView | null = null
    if (data.agentId) {
      try {
        const resolved = await client.get<ResolvedAgent>(
          `/api/agents/${encodeURIComponent(data.agentId)}`,
        )
        // Archived agents are hidden from the sidebar (includeArchived=false
        // above), so loading their chat via a stale URL would surface a
        // conversation no longer reachable from any UI — treat the same as
        // 404 here so the pane goes empty. Hard-deleted agents already
        // 404 from the GET above and are caught below.
        if (resolved.agent.status !== 'archived') {
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
        }
      } catch (err) {
        // 404 = bad ?agent= id. Drop the selection silently and render the
        // empty pane; surface other errors so the user sees them.
        if (!(err instanceof ApiClientError) || err.status !== 404) throw err
      }
    }
    return { agents, profiles, profileGroups, groups, selected, initialOpenGroups }
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
        profileGroups={data.profileGroups}
        selectedAgentId={selectedAgentId}
        initialOpenGroups={data.initialOpenGroups}
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
