// The workspace's left side: Teams with their Agents, each Agent with what it is doing right
// now. In a full-width view it folds to a column of avatars.

import { type Agent, DEFAULT_PROFILE_ID, DEFAULT_TEAM_ID, type Team } from '@bazilion/api-types'
import { Link, useRouter } from '@tanstack/react-router'
import {
  Archive,
  Bot,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  PanelLeft,
  PanelRight,
  Pencil,
  Plus,
  Send,
  Settings2,
  UsersRound,
} from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { useRef, useState } from 'react'
import { type AgentState, shortTime, teamSummary, useActivity } from '../../lib/activity'
import { archiveAgent, renameAgent } from '../../lib/agent-actions'
import { errorMessage } from '../../lib/api'
import { useHydrated } from '../../lib/use-resource'
import { AgentAvatar } from '../AgentAvatar'
import { Button } from '../Button'
import { ConfirmDialog } from '../ConfirmDialog'
import { Dialog, DialogActions } from '../Dialog'
import { SpawnDialog } from '../SpawnDialog'
import { SpawnTeamModal } from '../SpawnTeamModal'
import { TeamForm } from '../TeamForm'
import { useWorkspace } from './context'

// Read by the home loader so the first render already has the user's open/closed Teams. The value
// is URL-encoded JSON of Record<teamId, boolean>.
export const SIDEBAR_OPEN_GROUPS_COOKIE = 'bz_sidebar_open_groups'

function writeOpenGroupsCookie(map: Record<string, boolean>): void {
  // biome-ignore lint/suspicious/noDocumentCookie: a plain UI preference shared with SSR.
  document.cookie = `${SIDEBAR_OPEN_GROUPS_COOKIE}=${encodeURIComponent(JSON.stringify(map))}; Path=/; Max-Age=31536000; SameSite=Lax`
}

const MENU_ITEM =
  'flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-foreground outline-none transition-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50'
const MENU_LABEL =
  'flex items-center gap-1.5 px-2.5 pb-1 pt-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground'

const STATE_TEXT: Record<AgentState['kind'], string> = {
  needs: 'text-warning',
  working: 'text-success',
  paused: 'text-warning',
  fresh: 'text-accent-foreground',
  idle: 'text-muted-foreground',
}
export const STATE_DOT: Record<AgentState['kind'], string> = {
  needs: 'bg-warning',
  working: 'bg-success animate-pulse',
  paused: 'bg-fawn',
  fresh: 'bg-primary',
  idle: 'bg-fawn',
}

/** The Default Team first, then the rest as the daemon lists them. */
function sortTeams(teams: Team[]): Team[] {
  return [...teams].sort(
    (a, b) => Number(b.id === DEFAULT_TEAM_ID) - Number(a.id === DEFAULT_TEAM_ID),
  )
}

export function Rail({ initialOpenGroups }: { initialOpenGroups: Record<string, boolean> }) {
  const {
    agents,
    teams,
    profiles,
    teamTemplates,
    agent: open,
    team: inView,
    search,
  } = useWorkspace()
  const activity = useActivity()
  const router = useRouter()
  const [spawnProfile, setSpawnProfile] = useState<string | null>(null)
  const [spawnTeam, setSpawnTeam] = useState<string | undefined>(undefined)
  const [spawnTemplate, setSpawnTemplate] = useState<string | null>(null)
  const [createTeamOpen, setCreateTeamOpen] = useState(false)
  const [createTeamBusy, setCreateTeamBusy] = useState(false)
  const [renameTarget, setRenameTarget] = useState<Agent | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<Agent | null>(null)
  const [openGroups, setOpenGroups] = useState(initialOpenGroups)
  const newButton = useRef<HTMLButtonElement | null>(null)
  const refocusNewButton = () => window.requestAnimationFrame(() => newButton.current?.focus())

  // The seeded default template and Team come first: the one-click path for a new install.
  const sortedProfiles = [...profiles].sort(
    (a, b) => Number(b.id === DEFAULT_PROFILE_ID) - Number(a.id === DEFAULT_PROFILE_ID),
  )
  const sortedTeams = sortTeams(teams)
  const template = teamTemplates.find((entry) => entry.id === spawnTemplate)
  const selectedId = open?.agent.id ?? null

  return (
    <aside className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-baziu-sm">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-muted/60 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-[10px] bg-accent text-accent-foreground">
            <UsersRound className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight text-foreground">Teams</div>
            <p className="m-0 truncate text-xs leading-snug text-muted-foreground">
              {agents.length} agent{agents.length === 1 ? '' : 's'} in {teams.length} team
              {teams.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <button
              ref={newButton}
              type="button"
              aria-label="Create a new Agent or Team"
              className="unstyled group inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold text-foreground shadow-baziu-sm transition-colors hover:border-primary/30 hover:bg-accent hover:text-accent-foreground"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              New
              <ChevronDown
                className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
                aria-hidden="true"
              />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              className="z-50 w-60 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-baziu-lg outline-none"
            >
              <DropdownMenu.Label className={MENU_LABEL}>
                <Bot className="size-3" aria-hidden="true" />
                Agent templates
              </DropdownMenu.Label>
              {sortedProfiles.length === 0 ? (
                <DropdownMenu.Item asChild className={MENU_ITEM}>
                  <a href="/templates/agents?new=1">Create an Agent template</a>
                </DropdownMenu.Item>
              ) : (
                sortedProfiles.map((profile) => (
                  <DropdownMenu.Item
                    key={profile.id}
                    className={MENU_ITEM}
                    onSelect={() => {
                      setSpawnTeam(inView?.id)
                      setSpawnProfile(profile.id)
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{profile.name || profile.id}</span>
                    {profile.id === DEFAULT_PROFILE_ID && (
                      <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">
                        Default
                      </span>
                    )}
                  </DropdownMenu.Item>
                ))
              )}
              <DropdownMenu.Separator className="my-1.5 h-px bg-border" />
              <DropdownMenu.Label className={MENU_LABEL}>
                <UsersRound className="size-3" aria-hidden="true" />
                Team templates
              </DropdownMenu.Label>
              {teamTemplates.length === 0 ? (
                <DropdownMenu.Item asChild className={MENU_ITEM}>
                  <a href="/templates/teams?new=1">Create a Team template</a>
                </DropdownMenu.Item>
              ) : (
                teamTemplates.map((entry) => (
                  <DropdownMenu.Item
                    key={entry.id}
                    className={MENU_ITEM}
                    disabled={entry.slots.length === 0}
                    title={
                      entry.slots.length === 0
                        ? 'Add at least one member before spawning'
                        : undefined
                    }
                    onSelect={() => setSpawnTemplate(entry.id)}
                  >
                    <span className="min-w-0 flex-1 truncate">{entry.name || entry.id}</span>
                    <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-muted px-1.5 font-mono text-xs text-muted-foreground">
                      {entry.slots.length}
                    </span>
                  </DropdownMenu.Item>
                ))
              )}
              <DropdownMenu.Separator className="my-1.5 h-px bg-border" />
              <DropdownMenu.Item className={MENU_ITEM} onSelect={() => setCreateTeamOpen(true)}>
                <Plus className="size-3.5" aria-hidden="true" />
                Create a Team
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </header>

      <nav className="flex-1 overflow-y-auto p-1.5" aria-label="Teams and agents">
        {agents.length === 0 && (
          <div className="m-1 mb-2 flex flex-col items-center rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-center">
            <p className="m-0 text-sm font-semibold text-foreground">No agents yet</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Your default Team is ready. Spawn the first agent to start a conversation.
            </p>
            {sortedProfiles[0] ? (
              <Button
                variant="primary"
                className="mt-3"
                onClick={() => setSpawnProfile(sortedProfiles[0]?.id ?? DEFAULT_PROFILE_ID)}
              >
                Spawn first agent
              </Button>
            ) : (
              <a href="/templates/agents?new=1" className="mt-3 text-xs font-semibold">
                Create an Agent template
              </a>
            )}
          </div>
        )}
        {sortedTeams.map((team) => {
          const members = agents.filter((agent) => agent.teamId === team.id)
          const current = inView?.id === team.id
          // An explicit choice wins; otherwise the Team in view and the default Team start open.
          const isOpen = openGroups[team.id] ?? (current || team.id === DEFAULT_TEAM_ID)
          const summary = teamSummary(members.map((agent) => activity.stateOf(agent.id)))
          return (
            <details
              key={team.id}
              open={isOpen}
              onToggle={(event) => {
                const next = event.currentTarget.open
                if (next === isOpen) return
                const merged = { ...openGroups, [team.id]: next }
                writeOpenGroupsCookie(merged)
                setOpenGroups(merged)
              }}
              className="group/details mb-1 last:mb-0"
            >
              <summary
                className={`flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg py-1 pl-2 pr-1 text-sm transition-colors hover:bg-accent/60 [&::-webkit-details-marker]:hidden ${
                  current ? 'bg-muted text-foreground' : 'text-mocha'
                }`}
              >
                <ChevronRight
                  className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/details:rotate-90"
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate font-semibold">{team.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {summary || members.length}
                </span>
                <Link
                  to="/"
                  search={{
                    ...(open?.team.id === team.id ? { agent: open.agent.id } : {}),
                    team: team.id,
                    panel: 'team',
                  }}
                  aria-label={`Open ${team.name}: members, USER.md, memory`}
                  title="Open the Team"
                  className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-card hover:text-primary"
                >
                  <PanelRight className="size-3.5" aria-hidden="true" />
                </Link>
              </summary>
              {members.length === 0 ? (
                <div className="py-2 pl-7 pr-2 text-xs text-muted-foreground">
                  No agents in this team
                </div>
              ) : (
                <div className="space-y-0.5 py-1 pl-1.5">
                  {members.map((agent) => (
                    <AgentRow
                      key={agent.id}
                      agent={agent}
                      selected={agent.id === selectedId}
                      state={activity.stateOf(agent.id)}
                      lastActivityAt={activity.byAgent.get(agent.id)?.lastActivityAt ?? null}
                      panel={search.panel}
                      onRename={() => setRenameTarget(agent)}
                      onArchive={() => setArchiveTarget(agent)}
                    />
                  ))}
                </div>
              )}
            </details>
          )
        })}
      </nav>

      {spawnProfile && (
        <SpawnDialog
          profiles={sortedProfiles}
          teams={sortedTeams}
          profileId={spawnProfile}
          teamId={spawnTeam}
          onClose={() => {
            setSpawnProfile(null)
            refocusNewButton()
          }}
        />
      )}
      {template && (
        <SpawnTeamModal
          template={template}
          teams={sortedTeams}
          onClose={() => {
            setSpawnTemplate(null)
            refocusNewButton()
          }}
          onSpawned={(slug) => {
            setSpawnTemplate(null)
            void router.navigate({ to: '/', search: { team: slug, panel: 'team' } })
          }}
        />
      )}
      {createTeamOpen && (
        <Dialog
          title="Create a Team"
          description="A Team is one workspace: its folder, its Agents, its USER.md and shared memory, and who may message whom."
          busy={createTeamBusy}
          onClose={() => {
            setCreateTeamOpen(false)
            refocusNewButton()
          }}
        >
          <TeamForm
            onBusyChange={setCreateTeamBusy}
            onCreated={async (team) => {
              setCreateTeamOpen(false)
              await router.navigate({ to: '/', search: { team: team.id, panel: 'team' } })
            }}
            extraActions={(busy) => (
              <Button variant="ghost" disabled={busy} onClick={() => setCreateTeamOpen(false)}>
                Cancel
              </Button>
            )}
          />
        </Dialog>
      )}
      {renameTarget && (
        <RenameAgentDialog
          agent={renameTarget}
          onClose={() => setRenameTarget(null)}
          onRenamed={() => router.invalidate()}
        />
      )}
      <ConfirmDialog
        open={archiveTarget !== null}
        onOpenChange={(next) => {
          if (!next) setArchiveTarget(null)
        }}
        title={`Archive ${archiveTarget?.name ?? 'agent'}?`}
        description={
          <p>
            The Agent leaves this list and receives no work. Restore it later under Manage, Agents,
            with “Show archived”.
          </p>
        }
        confirmLabel="Archive agent"
        confirmVariant="primary"
        onConfirm={async () => {
          if (!archiveTarget) return
          await archiveAgent(archiveTarget.id)
          if (archiveTarget.id === selectedId) await router.navigate({ to: '/', search: {} })
          else await router.invalidate()
        }}
      />
    </aside>
  )
}

function AgentRow({
  agent,
  selected,
  state,
  lastActivityAt,
  panel,
  onRename,
  onArchive,
}: {
  agent: Agent
  selected: boolean
  state: AgentState
  lastActivityAt: number | null
  panel: ReturnType<typeof useWorkspace>['search']['panel']
  onRename: () => void
  onArchive: () => void
}) {
  const hydrated = useHydrated()
  return (
    <div className="group/row relative rounded-2xl">
      <Link
        to="/"
        search={{ agent: agent.id, ...(panel ? { panel } : {}) }}
        aria-current={selected ? 'page' : undefined}
        className={`flex min-h-[3.1rem] items-center gap-2.5 rounded-2xl border py-1.5 pl-2 pr-9 transition-colors hover:bg-accent/60 ${
          selected ? 'border-primary/20 bg-accent shadow-baziu-sm' : 'border-transparent'
        }`}
      >
        <AgentAvatar identity={agent.identity} size={30} />
        <span className="block min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span
              className={`min-w-0 truncate text-sm font-semibold leading-tight ${
                selected ? 'text-accent-foreground' : 'text-foreground'
              }`}
            >
              {agent.name}
            </span>
            {agent.telegramTopicId !== null && (
              <span
                className="shrink-0 text-primary"
                title={`Telegram topic #${agent.telegramTopicId}`}
                role="img"
                aria-label={`Bound to Telegram topic ${agent.telegramTopicId}`}
              >
                <Send className="size-3" aria-hidden="true" />
              </span>
            )}
            {hydrated && lastActivityAt !== null && (
              <time
                dateTime={new Date(lastActivityAt).toISOString()}
                className="ml-auto shrink-0 text-[0.7rem] font-normal text-muted-foreground"
              >
                {shortTime(lastActivityAt)}
              </time>
            )}
          </span>
          <span
            className={`mt-0.5 flex items-center gap-1.5 text-xs leading-snug ${STATE_TEXT[state.kind]}`}
          >
            <span
              className={`size-[7px] shrink-0 rounded-full ${STATE_DOT[state.kind]}`}
              aria-hidden="true"
            />
            <span className="min-w-0 truncate">{state.text}</span>
          </span>
        </span>
      </Link>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label={`More for ${agent.name}`}
            className="unstyled absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-card hover:text-primary focus-visible:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
          >
            <Ellipsis className="size-4" aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={4}
            className="z-50 w-48 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-baziu-lg outline-none"
          >
            <DropdownMenu.Item asChild className={MENU_ITEM}>
              <Link to="/" search={{ agent: agent.id, panel: 'agent' }}>
                <Settings2 className="size-3.5" aria-hidden="true" />
                Agent settings
              </Link>
            </DropdownMenu.Item>
            <DropdownMenu.Item className={MENU_ITEM} onSelect={onRename}>
              <Pencil className="size-3.5" aria-hidden="true" />
              Rename
            </DropdownMenu.Item>
            <DropdownMenu.Item className={MENU_ITEM} onSelect={onArchive}>
              <Archive className="size-3.5" aria-hidden="true" />
              Archive
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}

/** The rail folded to avatars, beside a full-width view. */
export function SlimRail() {
  const { agents, teams, agent: open, team: inView, search } = useWorkspace()
  const activity = useActivity()
  const sortedTeams = sortTeams(teams).filter((team) =>
    agents.some((agent) => agent.teamId === team.id),
  )
  // The Team in view comes first: its Agents are what the view is about.
  sortedTeams.sort((a, b) => Number(b.id === inView?.id) - Number(a.id === inView?.id))
  return (
    <nav
      aria-label="Agents"
      className="flex h-full w-16 flex-col items-center gap-2 overflow-y-auto rounded-xl border border-border bg-card py-2.5 shadow-baziu-sm"
    >
      <Link
        to="/"
        search={{ ...search, view: undefined, file: undefined, result: undefined }}
        aria-label="Back to the conversation and the full list"
        title="Back to the conversation"
        className="flex size-10 shrink-0 items-center justify-center rounded-xl text-mocha hover:bg-accent hover:text-accent-foreground"
      >
        <PanelLeft className="size-[18px]" aria-hidden="true" />
      </Link>
      {sortedTeams.map((team) => (
        <div key={team.id} className="flex w-full flex-col items-center gap-2">
          <div className="h-px w-8 bg-border" />
          <span
            className={`max-w-14 truncate text-[0.65rem] font-bold uppercase tracking-[0.06em] ${
              team.id === inView?.id ? 'text-accent-foreground' : 'text-muted-foreground'
            }`}
            title={team.name}
          >
            {team.name}
          </span>
          {agents
            .filter((agent) => agent.teamId === team.id)
            .map((agent) => {
              const state = activity.stateOf(agent.id)
              return (
                <Link
                  key={agent.id}
                  to="/"
                  search={{ agent: agent.id, ...(search.panel ? { panel: search.panel } : {}) }}
                  aria-label={`${agent.name}: ${state.text}`}
                  title={`${agent.name}: ${state.text}`}
                  className={`relative flex size-10 shrink-0 items-center justify-center rounded-full ${
                    agent.id === open?.agent.id
                      ? 'ring-2 ring-primary ring-offset-2 ring-offset-card'
                      : ''
                  }`}
                >
                  <AgentAvatar identity={agent.identity} size={40} />
                  <span
                    className={`absolute -bottom-px -right-px size-3 rounded-full border-2 border-card ${STATE_DOT[state.kind]}`}
                    aria-hidden="true"
                  />
                </Link>
              )
            })}
        </div>
      ))}
    </nav>
  )
}

function RenameAgentDialog({
  agent,
  onClose,
  onRenamed,
}: {
  agent: Agent
  onClose: () => void
  onRenamed: () => Promise<void>
}) {
  const [name, setName] = useState(agent.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const unchanged = !name.trim() || name.trim() === agent.name

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (unchanged) return
    setBusy(true)
    setError(null)
    try {
      await renameAgent(agent.id, name.trim())
      await onRenamed()
      onClose()
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={`Rename ${agent.name}`}
      description="This changes the display name only; the Agent ID and history stay the same."
      busy={busy}
      onClose={onClose}
      className="max-w-md"
    >
      <form onSubmit={(event) => void submit(event)}>
        <label>
          Agent name
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
          />
        </label>
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="mt-4">
          <DialogActions>
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={busy || unchanged}>
              {busy ? 'Renaming…' : 'Rename agent'}
            </Button>
          </DialogActions>
        </div>
      </form>
    </Dialog>
  )
}

export { RenameAgentDialog }
