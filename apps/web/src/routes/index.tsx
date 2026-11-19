// The workspace: the Teams and their Agents on the left, the open Agent's conversation in the
// middle, and everything about the work on the right (or across the whole width). The address
// says what is on screen; see lib/workspace.ts.

import type {
  ActivityResponse,
  Agent,
  Profile,
  ProviderMessage,
  ResolvedAgent,
  SessionHeadResponse,
  Team,
  TeamTemplate,
} from '@bazilion/api-types'
import { ApiClientError } from '@bazilion/client'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { ChangesView } from '../components/changes/ChangesView'
import { ReviewProvider } from '../components/changes/review'
import { ChatPane } from '../components/chat/ChatPane'
import { FilesView } from '../components/files/FilesView'
import { StatusBadge } from '../components/Page'
import { SidePanel } from '../components/panel/SidePanel'
import { ConversationHeader } from '../components/workspace/ConversationHeader'
import { WorkspaceProvider } from '../components/workspace/context'
import { EarlierConversation } from '../components/workspace/EarlierConversation'
import { FocusFrame } from '../components/workspace/FocusFrame'
import { Rail, SIDEBAR_OPEN_GROUPS_COOKIE, SlimRail } from '../components/workspace/Rail'
import { Sheets } from '../components/workspace/Sheets'
import { TeamHome } from '../components/workspace/TeamHome'
import { ActivityProvider } from '../lib/activity'
import { daemonClient } from '../lib/daemon-client'
import {
  PANEL_COOKIE,
  type PanelMemory,
  type PanelTab,
  parsePanelCookie,
  parseWorkspaceSearch,
  writePanelCookie,
} from '../lib/workspace'

// The map brings a graph library with it: it loads when the map is first opened.
const ConnectionsView = lazy(() =>
  import('../components/connections/ConnectionsView').then((module) => ({
    default: module.ConnectionsView,
  })),
)

interface SelectedAgent {
  resolved: ResolvedAgent
  messages: ProviderMessage[]
  head: SessionHeadResponse
}

/** The rail's open/closed Teams; a bad cookie is ignored. */
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

const fetchWorkspace = createServerFn({ method: 'GET' })
  .validator((data: { agentId?: string }) => data)
  .handler(async ({ data }) => {
    const client = daemonClient()
    const [agents, profiles, teamTemplates, teams, activity] = await Promise.all([
      client.get<Agent[]>('/api/agents?includeArchived=false'),
      client.get<Profile[]>('/api/profiles'),
      client.get<TeamTemplate[]>('/api/team-templates'),
      client.get<Team[]>('/api/teams'),
      client.get<ActivityResponse>('/api/activity'),
    ])
    let selected: SelectedAgent | null = null
    if (data.agentId) {
      try {
        const resolved = await client.get<ResolvedAgent>(
          `/api/agents/${encodeURIComponent(data.agentId)}`,
        )
        const history = await client.get<{
          messages: ProviderMessage[]
          head: SessionHeadResponse
        }>(`/api/agents/${encodeURIComponent(resolved.agent.id)}/sessions/messages`)
        selected = { resolved, messages: history.messages, head: history.head }
      } catch (err) {
        // An unknown ?agent= id shows the list; other failures surface.
        if (!(err instanceof ApiClientError) || err.status !== 404) throw err
      }
    }
    return {
      agents,
      profiles,
      teamTemplates,
      teams,
      selected,
      activity: activity.agents,
      openGroups: parseOpenGroupsCookie(getCookie(SIDEBAR_OPEN_GROUPS_COOKIE)),
      panel: parsePanelCookie(getCookie(PANEL_COOKIE)),
    }
  })

export const Route = createFileRoute('/')({
  validateSearch: parseWorkspaceSearch,
  loaderDeps: ({ search }) => ({ agentId: search.agent }),
  loader: ({ deps }) => fetchWorkspace({ data: { agentId: deps.agentId } }),
  component: WorkspacePage,
})

function WorkspacePage() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const router = useRouter()
  const { agents, teams, selected } = data
  const open = selected?.resolved ?? null
  const team = open?.team ?? teams.find((entry) => entry.id === search.team) ?? null
  // A full-width view is about a Team: without one there is nothing to show.
  const view = team ? search.view : undefined
  const names = useMemo(() => new Map(agents.map((agent) => [agent.id, agent.name])), [agents])

  // The side panel opens on the tab it was last on; the address, when it says, wins.
  const [memory, setMemory] = useState<PanelMemory>(data.panel)
  useEffect(() => {
    if (!search.panel) return
    setMemory((current) => {
      const next: PanelMemory =
        search.panel === 'none'
          ? { open: false, tab: current.tab }
          : { open: true, tab: search.panel as PanelTab }
      if (next.open === current.open && next.tab === current.tab) return current
      writePanelCookie(next)
      return next
    })
  }, [search.panel])
  const panel: PanelTab | 'none' = search.panel ?? (memory.open ? memory.tab : 'none')
  // Below the widest layout the panel covers the conversation, so there it opens only when asked.
  const asked = search.panel !== undefined && search.panel !== 'none'

  // The conversation on screen: the one being read, else the open Agent's active one, which the
  // chat reports when a first turn creates it or another one is loaded.
  // A report counts while the page's data is the data it was made against: loading the data
  // again (another conversation was continued) makes the data the newer of the two.
  const [reported, setReported] = useState<{
    agentId: string
    loaded: string | null
    id: string | null
  } | null>(null)
  const loadedConversation = selected?.head.conversationId ?? null
  const activeConversation =
    open && reported?.agentId === open.agent.id && reported.loaded === loadedConversation
      ? reported.id
      : loadedConversation
  const reading =
    open && search.conversation && search.conversation !== activeConversation
      ? search.conversation
      : null
  const conversationId = open ? (reading ?? activeConversation) : null

  const workspace = useMemo(
    () => ({
      agents,
      teams,
      profiles: data.profiles,
      teamTemplates: data.teamTemplates,
      agent: open,
      team,
      conversationId,
      search,
    }),
    [agents, teams, data.profiles, data.teamTemplates, open, team, conversationId, search],
  )

  const header = (
    chat?: Parameters<NonNullable<React.ComponentProps<typeof ChatPane>['header']>>[0],
  ) =>
    open && (
      <>
        <ConversationHeader agent={open} chat={chat} panel={panel} lastPanel={memory.tab} />
        {open.agent.status === 'archived' && (
          <p className="m-0 flex flex-wrap items-center gap-2 border-b border-frost bg-warning/[0.07] px-4 py-2 text-sm text-chocolate">
            <StatusBadge variant="warning">Archived</StatusBadge>
            This Agent receives no work. Restore it from its settings to talk to it again.
            <Link to="/" search={{ ...search, panel: 'agent' }} className="font-semibold">
              Agent settings
            </Link>
          </p>
        )}
      </>
    )

  return (
    <ActivityProvider
      initial={data.activity}
      openAgentId={view ? null : (open?.agent.id ?? null)}
      names={names}
    >
      <WorkspaceProvider value={workspace}>
        <ReviewProvider>
          {view && team ? (
            <div className="grid h-full min-h-0 grid-cols-1 gap-3 py-3 sm:grid-cols-[4rem_minmax(0,1fr)]">
              <div className="hidden min-h-0 sm:block">
                <SlimRail />
              </div>
              <div className="min-h-0 min-w-0">
                {view === 'connections' ? (
                  <Suspense
                    fallback={
                      <FocusFrame view="connections">
                        <p role="status" className="m-4 text-sm text-muted-foreground">
                          Loading the map…
                        </p>
                      </FocusFrame>
                    }
                  >
                    <ConnectionsView key={team.id} team={team} />
                  </Suspense>
                ) : view === 'changes' ? (
                  <ChangesView key={team.id} team={team} />
                ) : (
                  <FilesView key={team.id} team={team} />
                )}
              </div>
            </div>
          ) : (
            <div
              className={`grid h-full min-h-0 grid-cols-1 gap-3 py-3 lg:grid-cols-[18rem_minmax(0,1fr)] ${
                panel === 'none' ? '' : 'xl:grid-cols-[18rem_minmax(0,1fr)_minmax(22rem,27rem)]'
              }`}
            >
              <div className={`min-h-0 ${open || team ? 'hidden lg:block' : ''}`}>
                <Rail initialOpenGroups={data.openGroups} />
              </div>
              <div className={`min-h-0 min-w-0 ${open || team ? '' : 'hidden lg:block'}`}>
                {open && selected ? (
                  reading ? (
                    <EarlierConversation
                      key={`${open.agent.id}:${reading}`}
                      agentId={open.agent.id}
                      agentName={open.agent.name}
                      conversationId={reading}
                      header={header()}
                    />
                  ) : (
                    <ChatPane
                      agentId={open.agent.id}
                      agentName={open.agent.name}
                      initialMessages={selected.messages}
                      initialSessionHead={selected.head}
                      header={header}
                      onViewConversation={(id) =>
                        void router.navigate({ to: '/', search: { ...search, conversation: id } })
                      }
                      onConversationChange={(id) =>
                        setReported({ agentId: open.agent.id, loaded: loadedConversation, id })
                      }
                    />
                  )
                ) : team ? (
                  <TeamHome team={team} />
                ) : (
                  <div className="flex h-full items-center justify-center rounded-2xl border border-dashed bg-card px-6 text-center text-muted-foreground">
                    <div className="max-w-sm">
                      <h1 className="m-0 font-body text-lg font-semibold text-foreground">
                        {agents.length === 0 ? 'Start your first conversation' : 'Choose an agent'}
                      </h1>
                      <p className="mt-2 text-sm leading-6">
                        {agents.length === 0
                          ? 'Your default Team and Agent template are ready. Use “Spawn first agent” on the left to create a working member.'
                          : 'Pick an agent on the left to open its conversation. “Jump to” at the top finds any Agent or Team by name.'}
                      </p>
                    </div>
                  </div>
                )}
              </div>
              {panel !== 'none' && (
                <>
                  {asked && (
                    <Link
                      to="/"
                      search={{ ...search, panel: 'none', section: undefined }}
                      aria-label="Close the side panel"
                      className="fixed inset-0 z-30 bg-chocolate/30 xl:hidden"
                    />
                  )}
                  <div
                    className={
                      asked
                        ? 'fixed inset-y-0 right-0 z-40 w-[min(27rem,100vw)] p-2 xl:static xl:z-auto xl:min-h-0 xl:w-auto xl:min-w-0 xl:p-0'
                        : 'hidden min-h-0 min-w-0 xl:block'
                    }
                  >
                    <SidePanel tab={panel} />
                  </div>
                </>
              )}
            </div>
          )}
          <Sheets />
        </ReviewProvider>
      </WorkspaceProvider>
    </ActivityProvider>
  )
}
