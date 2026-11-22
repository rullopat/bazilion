import type { Agent, Team } from '@bazilion/api-types'
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { UsersRound } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Dialog } from '../../components/Dialog'
import { ManagePage } from '../../components/ManagePage'
import { AvatarStack } from '../../components/manage/AvatarStack'
import { TeamForm } from '../../components/TeamForm'
import { CardEmpty, CardList, Chip, ListRow, RowMenu, SetupCard } from '../../components/ui/parts'
import { api } from '../../lib/api'
import { daemonClient } from '../../lib/daemon-client'
import { count, teamRemoveBlocker } from '../../lib/manage'

const fetchTeams = createServerFn({ method: 'GET' }).handler(async () => {
  const client = daemonClient()
  const [teams, agents] = await Promise.all([
    client.get<Team[]>('/api/teams'),
    client.get<Agent[]>('/api/agents?includeArchived=true'),
  ])
  return { teams, agents }
})

export const Route = createFileRoute('/teams/')({
  loader: () => fetchTeams(),
  component: TeamsPage,
})

function TeamsPage() {
  const { teams, agents } = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [creatingBusy, setCreatingBusy] = useState(false)
  const [removing, setRemoving] = useState<Team | null>(null)

  return (
    <ManagePage
      title="Teams"
      description="Each Team is one workspace: a folder its Agents work in, its USER.md and shared memory, and who may message whom. Every Agent belongs to exactly one Team."
      actions={
        <Button variant="primary" onClick={() => setCreating(true)}>
          Create a Team
        </Button>
      }
    >
      <SetupCard
        labelledBy="manage-teams"
        icon={<UsersRound className="size-5" />}
        title="Teams"
        description="Open one for its members, USER.md, memory and connections."
        action={<Chip tone="neutral">{count(teams.length, 'Team')}</Chip>}
      >
        {teams.length === 0 ? (
          <CardEmpty
            icon={<UsersRound className="size-5" />}
            title="No Teams yet"
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                Create a Team
              </Button>
            }
          >
            A Team gives Agents a folder to work in and a way to talk to each other.
          </CardEmpty>
        ) : (
          <CardList>
            {teams.map((team) => {
              const members = agents.filter((agent) => agent.teamId === team.id)
              const current = members.filter((agent) => agent.status !== 'archived')
              const archived = members.length - current.length
              const blocker = teamRemoveBlocker(members.length)
              return (
                <ListRow
                  key={team.id}
                  leading={
                    // A fixed slot, so that the names line up whatever the number of avatars.
                    <span className="flex w-[5.25rem]">
                      {current.length > 0 ? (
                        <AvatarStack agents={current} />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground"
                        >
                          <UsersRound className="size-4" />
                        </span>
                      )}
                    </span>
                  }
                  title={
                    <Link
                      to="/"
                      search={{ team: team.id, panel: 'team' }}
                      className="text-foreground hover:text-primary"
                    >
                      {team.name}
                    </Link>
                  }
                  chip={team.policyMode === 'restricted' && <Chip tone="neutral">Restricted</Chip>}
                  meta={
                    <>
                      <span>
                        {current.length === 0
                          ? 'No Agents'
                          : current.map((agent) => agent.name).join(', ')}
                        {archived > 0 && ` · ${archived} archived`}
                      </span>
                      <span>
                        {team.policyMode === 'restricted'
                          ? 'Members message each other along connections'
                          : 'Members message each other freely'}
                      </span>
                      <code>{team.id}</code>
                    </>
                  }
                  actions={
                    <RowMenu
                      label={`More for ${team.name}`}
                      items={[
                        {
                          label: 'Connections',
                          onSelect: () =>
                            void navigate({
                              to: '/',
                              search: { team: team.id, view: 'connections' },
                            }),
                        },
                        {
                          label: 'Changes',
                          onSelect: () =>
                            void navigate({ to: '/', search: { team: team.id, view: 'changes' } }),
                        },
                        {
                          label: 'Remove…',
                          danger: true,
                          disabledReason: blocker,
                          onSelect: () => setRemoving(team),
                        },
                      ]}
                    />
                  }
                />
              )
            })}
          </CardList>
        )}
      </SetupCard>

      {creating && (
        <Dialog
          title="Create a Team"
          description="A Team is one workspace: its folder, its Agents, its USER.md and shared memory, and who may message whom."
          busy={creatingBusy}
          onClose={() => setCreating(false)}
        >
          <TeamForm
            onBusyChange={setCreatingBusy}
            onCreated={async () => {
              setCreating(false)
              await router.invalidate({ sync: true })
            }}
            extraActions={(busy) => (
              <Button variant="ghost" disabled={busy} onClick={() => setCreating(false)}>
                Cancel
              </Button>
            )}
          />
        </Dialog>
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        title={`Remove ${removing?.name ?? 'the Team'}?`}
        description={
          <p className="m-0">
            This removes the empty Team, its USER.md and shared memory, and its folder in the
            Bazilion home. When the Team links to a project folder, only the link is removed, never
            the folder.
          </p>
        }
        confirmLabel="Remove Team"
        onConfirm={async () => {
          if (!removing) return
          await api(`/api/teams/${encodeURIComponent(removing.id)}`, { method: 'DELETE' })
          await router.invalidate({ sync: true })
        }}
      />
    </ManagePage>
  )
}
