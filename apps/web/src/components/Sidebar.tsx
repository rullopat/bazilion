// Left sidebar of the home page: collapsible Teams with their Agents, and the New menu.

import {
  type Agent,
  DEFAULT_PROFILE_ID,
  DEFAULT_TEAM_ID,
  type Profile,
  type Team,
  type TeamTemplate,
} from '@bazilion/api-types'
import { Link, useRouter } from '@tanstack/react-router'
import {
  Archive,
  Bot,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Send,
  UsersRound,
} from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { useRef, useState } from 'react'
import { archiveAgent, renameAgent } from '../lib/agent-actions'
import { errorMessage } from '../lib/api'
import { Button } from './Button'
import { ConfirmDialog } from './ConfirmDialog'
import { Dialog, DialogActions } from './Dialog'
import { SpawnDialog } from './SpawnDialog'
import { SpawnTeamModal } from './SpawnTeamModal'
import { TeamForm } from './TeamForm'

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

export function Sidebar({
  agents,
  teams,
  profiles,
  teamTemplates,
  selectedAgentId,
  initialOpenGroups,
}: {
  agents: Agent[]
  teams: Team[]
  profiles: Profile[]
  teamTemplates: TeamTemplate[]
  selectedAgentId: string | null
  /** Per-Team open/closed map from the cookie. */
  initialOpenGroups: Record<string, boolean>
}) {
  const router = useRouter()
  const [spawnProfile, setSpawnProfile] = useState<string | null>(null)
  const [spawnTemplate, setSpawnTemplate] = useState<TeamTemplate | null>(null)
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
  const sortedTeams = [...teams].sort(
    (a, b) => Number(b.id === DEFAULT_TEAM_ID) - Number(a.id === DEFAULT_TEAM_ID),
  )
  const agentsByTeam = new Map<string, Agent[]>()
  for (const agent of agents) {
    agentsByTeam.set(agent.teamId, [...(agentsByTeam.get(agent.teamId) ?? []), agent])
  }
  const selectedTeamId = agents.find((agent) => agent.id === selectedAgentId)?.teamId ?? null

  return (
    <aside className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-baziu-sm">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className="flex size-7 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <Bot className="size-4" aria-hidden="true" />
            </span>
            <span>Agents</span>
          </div>
          <p className="mt-0.5 truncate pl-9 text-xs text-muted-foreground">
            {agents.length} agent{agents.length === 1 ? '' : 's'} across {teams.length} team
            {teams.length === 1 ? '' : 's'}
          </p>
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
                  <a href="/templates/agents">Create an Agent template</a>
                </DropdownMenu.Item>
              ) : (
                sortedProfiles.map((profile) => (
                  <DropdownMenu.Item
                    key={profile.id}
                    className={MENU_ITEM}
                    onSelect={() => setSpawnProfile(profile.id)}
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
                  <a href="/templates/teams">Create a Team template</a>
                </DropdownMenu.Item>
              ) : (
                teamTemplates.map((template) => (
                  <DropdownMenu.Item
                    key={template.id}
                    className={MENU_ITEM}
                    disabled={template.slots.length === 0}
                    title={
                      template.slots.length === 0
                        ? 'Add at least one member before spawning'
                        : undefined
                    }
                    onSelect={() => setSpawnTemplate(template)}
                  >
                    <span className="min-w-0 flex-1 truncate">{template.name || template.id}</span>
                    <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-muted px-1.5 font-mono text-xs text-muted-foreground">
                      {template.slots.length}
                    </span>
                  </DropdownMenu.Item>
                ))
              )}
              <DropdownMenu.Separator className="my-1.5 h-px bg-border" />
              <DropdownMenu.Item className={MENU_ITEM} onSelect={() => setCreateTeamOpen(true)}>
                <Plus className="size-3.5" aria-hidden="true" />
                Create a team
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </header>

      <nav className="flex-1 overflow-y-auto p-1.5" aria-label="Teams and agents">
        {agents.length === 0 ? (
          <div className="m-1 flex flex-col items-center rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-center">
            <p className="text-sm font-semibold text-foreground">No agents yet</p>
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
              <a href="/templates/agents" className="mt-3 text-xs font-semibold">
                Create an Agent template
              </a>
            )}
          </div>
        ) : (
          sortedTeams.map((team) => {
            const teamAgents = agentsByTeam.get(team.id) ?? []
            const containsSelected = selectedTeamId === team.id
            // An explicit choice wins; otherwise the default Team and the selected Agent's Team
            // start open.
            const open = openGroups[team.id] ?? (containsSelected || team.id === DEFAULT_TEAM_ID)
            return (
              <details
                key={team.id}
                open={open}
                onToggle={(event) => {
                  const next = event.currentTarget.open
                  if (next === open) return
                  const merged = { ...openGroups, [team.id]: next }
                  writeOpenGroupsCookie(merged)
                  setOpenGroups(merged)
                }}
                className="group/details mb-1 last:mb-0"
              >
                <summary
                  className={`flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground ${
                    containsSelected ? 'bg-muted/60 text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  <ChevronRight
                    className="size-3.5 shrink-0 transition-transform group-open/details:rotate-90"
                    aria-hidden="true"
                  />
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <UsersRound className="size-3" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{team.name}</span>
                  {team.id === DEFAULT_TEAM_ID && (
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Default
                    </span>
                  )}
                  <span className="inline-flex min-w-6 items-center justify-center rounded-full border border-border bg-card px-1.5 font-mono text-xs text-muted-foreground">
                    {teamAgents.length}
                  </span>
                </summary>
                {teamAgents.length === 0 ? (
                  <div className="py-2 pl-12 pr-2 text-xs text-muted-foreground">
                    No agents in this team
                  </div>
                ) : (
                  <div className="space-y-0.5 py-0.5 pl-2">
                    {teamAgents.map((agent) => (
                      <AgentRow
                        key={agent.id}
                        agent={agent}
                        selected={agent.id === selectedAgentId}
                        onRename={() => setRenameTarget(agent)}
                        onArchive={() => setArchiveTarget(agent)}
                      />
                    ))}
                  </div>
                )}
              </details>
            )
          })
        )}
      </nav>

      {spawnProfile && (
        <SpawnDialog
          profiles={sortedProfiles}
          teams={sortedTeams}
          profileId={spawnProfile}
          onClose={() => {
            setSpawnProfile(null)
            refocusNewButton()
          }}
        />
      )}
      {spawnTemplate && (
        <SpawnTeamModal
          template={spawnTemplate}
          teams={sortedTeams}
          onClose={() => {
            setSpawnTemplate(null)
            refocusNewButton()
          }}
          onSpawned={(slug) => {
            setSpawnTemplate(null)
            void router.navigate({ to: '/teams/$id', params: { id: slug } })
          }}
        />
      )}
      {createTeamOpen && (
        <Dialog
          title="Create a team"
          description="A Team is one workspace with its own USER.md, members and shared memory."
          busy={createTeamBusy}
          onClose={() => {
            setCreateTeamOpen(false)
            refocusNewButton()
          }}
        >
          <TeamForm
            onBusyChange={setCreateTeamBusy}
            onCreated={async () => {
              setCreateTeamOpen(false)
              await router.invalidate()
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
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null)
        }}
        title={`Archive ${archiveTarget?.name ?? 'agent'}?`}
        description={
          <p>
            The Agent will stop appearing in this sidebar and cannot receive normal work. You can
            restore it later from the Agents page with “Show archived”.
          </p>
        }
        confirmLabel="Archive agent"
        confirmVariant="primary"
        onConfirm={async () => {
          if (!archiveTarget) return
          await archiveAgent(archiveTarget.id)
          await router.invalidate()
        }}
      />
    </aside>
  )
}

function AgentRow({
  agent,
  selected,
  onRename,
  onArchive,
}: {
  agent: Agent
  selected: boolean
  onRename: () => void
  onArchive: () => void
}) {
  return (
    <div className="relative rounded-lg">
      <Link
        to="/"
        search={{ agent: agent.id }}
        aria-current={selected ? 'page' : undefined}
        className={`block min-h-11 rounded-lg border border-transparent py-1.5 pl-2.5 pr-[4.6rem] transition-colors hover:bg-accent/70 ${
          selected
            ? 'border-primary/20 bg-accent text-accent-foreground shadow-baziu-sm'
            : 'text-foreground'
        }`}
      >
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <span
            className={`size-1.5 shrink-0 rounded-full ${selected ? 'bg-primary' : 'bg-border'}`}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate">{agent.name}</span>
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
        </div>
        <div className="mt-0.5 flex gap-2 pl-3 font-mono text-xs text-muted-foreground">
          <span className="uppercase tracking-wide">{agent.status}</span>
          <span>{agent.id.slice(0, 8)}</span>
        </div>
      </Link>
      <div className="absolute right-1 top-1/2 z-10 flex -translate-y-1/2 gap-0.5">
        <button
          type="button"
          onClick={onRename}
          title="Rename"
          aria-label={`Rename ${agent.name}`}
          className="unstyled flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-card hover:text-primary focus-visible:bg-card"
        >
          <Pencil className="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onArchive}
          title="Archive"
          aria-label={`Archive ${agent.name}`}
          className="unstyled flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive"
        >
          <Archive className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
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
