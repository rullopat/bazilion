import type { Agent, Profile, Team } from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { AgentAvatar } from '../../components/AgentAvatar'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import {
  EmptyState,
  ItemList,
  ItemRow,
  PageHeader,
  PageShell,
  SectionCard,
  StatusBadge,
} from '../../components/Page'
import { SpawnDialog } from '../../components/SpawnDialog'
import { archiveAgent, deleteAgent, unarchiveAgent } from '../../lib/agent-actions'
import { errorMessage } from '../../lib/api'
import { daemonClient } from '../../lib/daemon-client'

const fetchAgents = createServerFn({ method: 'GET' })
  .validator((data: { all: boolean }) => data)
  .handler(async ({ data }) => {
    const client = daemonClient()
    const [agents, profiles, teams] = await Promise.all([
      client.get<Agent[]>(`/api/agents?includeArchived=${data.all}`),
      client.get<Profile[]>('/api/profiles'),
      client.get<Team[]>('/api/teams'),
    ])
    return { agents, profiles, teams }
  })

export const Route = createFileRoute('/agents/')({
  // The router parses `?all=1` into the number 1 (and would rewrite a string '1' as `"1"`).
  validateSearch: (search: Record<string, unknown>): { all?: 1 } => ({
    all: search.all === 1 ? 1 : undefined,
  }),
  loaderDeps: ({ search }) => ({ all: search.all === 1 }),
  loader: ({ deps }) => fetchAgents({ data: { all: deps.all } }),
  component: AgentsPage,
})

function AgentsPage() {
  const { agents, profiles, teams } = Route.useLoaderData()
  const showAll = Route.useSearch().all === 1
  const router = useRouter()
  const [spawning, setSpawning] = useState(false)
  const [pending, setPending] = useState<{ kind: 'archive' | 'delete'; agent: Agent } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function restore(agent: Agent) {
    setError(null)
    try {
      await unarchiveAgent(agent.id)
      await router.invalidate()
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  return (
    <PageShell size="wide">
      <PageHeader
        eyebrow="Workspace"
        title="Agents"
        description="Spawn, inspect, archive and restore the agents that work across your teams. Skills come from the Agent template at spawn; adjust them later on an Agent's settings."
        actions={
          <>
            <a className="ghost-btn" href={showAll ? '/agents' : '/agents?all=1'}>
              {showAll ? 'Hide archived' : 'Show archived'}
            </a>
            <Button
              variant="primary"
              disabled={profiles.length === 0}
              onClick={() => setSpawning(true)}
            >
              Spawn agent
            </Button>
          </>
        }
      />

      {error && (
        <p role="alert" className="err">
          {error}
        </p>
      )}

      <SectionCard
        title={showAll ? 'All agents' : 'Current agents'}
        description={
          showAll
            ? 'Active and archived agents are shown together.'
            : 'Archived agents stay hidden until you choose to show them.'
        }
      >
        {agents.length === 0 ? (
          <EmptyState
            title={showAll ? 'No agents yet' : 'No current agents'}
            description="Spawn an agent to give a team its first working member."
          />
        ) : (
          <ItemList>
            {agents.map((agent) => (
              <ItemRow
                key={agent.id}
                title={
                  <span className="flex min-w-0 items-center gap-2">
                    <AgentAvatar identity={agent.identity} size={26} />
                    <a href={`/agents/${agent.id}`} className="truncate">
                      {agent.name}
                    </a>
                    <StatusBadge variant={agent.status === 'archived' ? 'warning' : 'success'}>
                      {agent.status}
                    </StatusBadge>
                  </span>
                }
                meta={
                  <>
                    {(agent.identity?.creature || agent.identity?.vibe) && (
                      <span>
                        {[agent.identity?.creature, agent.identity?.vibe]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    )}
                    <span>
                      template <code>{agent.profileId}</code>
                    </span>
                    <span>
                      team <code>{agent.teamId}</code>
                    </span>
                    <code title={agent.id}>{agent.id.slice(0, 8)}</code>
                  </>
                }
                actions={
                  <>
                    {agent.status === 'archived' ? (
                      <Button variant="ghost" onClick={() => void restore(agent)}>
                        Restore
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        onClick={() => setPending({ kind: 'archive', agent })}
                      >
                        Archive
                      </Button>
                    )}
                    <Button variant="danger" onClick={() => setPending({ kind: 'delete', agent })}>
                      Delete
                    </Button>
                  </>
                }
              />
            ))}
          </ItemList>
        )}
      </SectionCard>

      {spawning && (
        <SpawnDialog profiles={profiles} teams={teams} onClose={() => setSpawning(false)} />
      )}
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
        title={
          pending?.kind === 'delete'
            ? `Delete ${pending.agent.name} permanently?`
            : `Archive ${pending?.agent.name ?? 'agent'}?`
        }
        description={
          pending?.kind === 'delete' ? (
            <p>
              This permanently removes the Agent, its messages, triggers, skill attachments,
              sessions, and private on-disk directory. This cannot be undone.
            </p>
          ) : (
            <p>
              The Agent will stop appearing in current lists and cannot receive normal work. You can
              restore it later from “Show archived”.
            </p>
          )
        }
        confirmLabel={pending?.kind === 'delete' ? 'Delete permanently' : 'Archive agent'}
        confirmVariant={pending?.kind === 'delete' ? 'danger' : 'primary'}
        onConfirm={async () => {
          if (!pending) return
          if (pending.kind === 'delete') await deleteAgent(pending.agent.id)
          else await archiveAgent(pending.agent.id)
          await router.invalidate()
        }}
      />
    </PageShell>
  )
}
