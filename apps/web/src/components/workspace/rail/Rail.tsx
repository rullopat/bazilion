// The workspace's left side: Teams with their Agents, each Agent with what it is doing right
// now. In a full-width view it folds to a column of avatars (SlimRail).

import { type Agent, DEFAULT_PROFILE_ID } from '@bazilion/api-types'
import { useRouter } from '@tanstack/react-router'
import { UsersRound } from 'lucide-react'
import { useRef, useState } from 'react'
import { useActivity } from '../../../lib/activity'
import { archiveAgent } from '../../../lib/agent-actions'
import { RenameAgentDialog } from '../../agent/RenameAgentDialog'
import { Button } from '../../Button'
import { ConfirmDialog } from '../../ConfirmDialog'
import { Dialog } from '../../Dialog'
import { SpawnDialog } from '../../SpawnDialog'
import { SpawnTeamModal } from '../../SpawnTeamModal'
import { TeamForm } from '../../TeamForm'
import { useWorkspace } from '../context'
import { NewMenu } from './NewMenu'
import { isGroupOpen, writeOpenGroupsCookie } from './open-groups'
import { sortProfiles, sortTeams } from './order'
import { TeamGroup } from './TeamGroup'

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
  const sortedProfiles = sortProfiles(profiles)
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
        <NewMenu
          buttonRef={newButton}
          profiles={sortedProfiles}
          teamTemplates={teamTemplates}
          onSpawnAgent={(profileId) => {
            setSpawnTeam(inView?.id)
            setSpawnProfile(profileId)
          }}
          onSpawnTeam={(templateId) => setSpawnTemplate(templateId)}
          onCreateTeam={() => setCreateTeamOpen(true)}
        />
      </header>

      <nav className="flex-1 overflow-y-auto p-1.5" aria-label="Teams and agents">
        {agents.length === 0 && (
          <div className="m-1 mb-2 flex flex-col items-center rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-center">
            <p className="m-0 text-sm font-semibold text-foreground">No agents yet</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Your default Team is ready. Add the first Agent to start a conversation.
            </p>
            {sortedProfiles[0] ? (
              <Button
                variant="primary"
                className="mt-3"
                onClick={() => setSpawnProfile(sortedProfiles[0]?.id ?? DEFAULT_PROFILE_ID)}
              >
                Add the first Agent
              </Button>
            ) : (
              <a href="/templates/agents?new=1" className="mt-3 text-xs font-semibold">
                Create an Agent template
              </a>
            )}
          </div>
        )}
        {sortedTeams.map((team) => {
          const current = inView?.id === team.id
          return (
            <TeamGroup
              key={team.id}
              team={team}
              members={agents.filter((agent) => agent.teamId === team.id)}
              current={current}
              isOpen={isGroupOpen(openGroups, team.id, current)}
              onOpenChange={(next) => {
                const merged = { ...openGroups, [team.id]: next }
                writeOpenGroupsCookie(merged)
                setOpenGroups(merged)
              }}
              openAgentId={open?.team.id === team.id ? open.agent.id : null}
              selectedId={selectedId}
              activity={activity}
              panel={search.panel}
              onRename={(agent) => setRenameTarget(agent)}
              onArchive={(agent) => setArchiveTarget(agent)}
            />
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
            taken={teams.map((team) => team.id)}
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
            The Agent leaves this list and receives no work. Restore it later under Manage → Agents,
            in Archived.
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
