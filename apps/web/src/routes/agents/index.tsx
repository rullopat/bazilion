import type { Agent, Team, Profile, ResolvedTeamPolicy } from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { AgentAvatar } from '../../components/AgentAvatar'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import {
  EmptyState,
  PageHeader,
  PageShell,
  SectionCard,
  StatusBadge,
} from '../../components/Page'
import { daemonClient } from '../../lib/daemon-client'

interface ModelGroup {
  provider: string
  models: string[]
}
interface AvailableModelsResponse {
  teams: ModelGroup[]
}

interface AgentsView {
  agents: Agent[]
  profiles: Profile[]
  teams: Team[]
  modelGroups: ModelGroup[]
}

const fetchAgents = createServerFn({ method: 'POST' })
  .validator((d: { all: boolean }) => d)
  .handler(async ({ data }): Promise<AgentsView> => {
    const c = daemonClient()
    const [agents, profiles, teams, models] = await Promise.all([
      c.get<Agent[]>(`/api/agents?includeArchived=${data.all}`),
      c.get<Profile[]>('/api/profiles'),
      c.get<Team[]>('/api/teams'),
      c.get<AvailableModelsResponse>('/api/config/available-models'),
    ])
    return { agents, profiles, teams, modelGroups: models.teams }
  })

export const Route = createFileRoute('/agents/')({
  validateSearch: (s: Record<string, unknown>): { all?: '1' } => ({
    all: s.all === '1' ? '1' : undefined,
  }),
  loaderDeps: ({ search }) => ({ all: search.all === '1' }),
  loader: ({ deps }) => fetchAgents({ data: { all: deps.all } }),
  component: AgentsPage,
})

function AgentsPage() {
  const { agents, profiles, teams, modelGroups } = Route.useLoaderData()
  const { all } = Route.useSearch()
  const showAll = all === '1'
  const router = useRouter()
  const [pendingAction, setPendingAction] = useState<
    { kind: 'archive' | 'delete'; agent: Agent } | null
  >(null)
  const [actionError, setActionError] = useState<string | null>(null)

  async function archive(id: string) {
    const response = await fetch(`/api/agents/${encodeURIComponent(id)}/archive`, {
      method: 'POST',
    })
    if (!response.ok && response.status !== 204) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      throw new Error(body?.error ?? `Could not archive agent (${response.status})`)
    }
    await router.invalidate()
  }
  async function unarchive(id: string) {
    setActionError(null)
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(id)}/unarchive`, {
        method: 'POST',
      })
      if (!response.ok && response.status !== 204) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `Could not restore agent (${response.status})`)
      }
      await router.invalidate()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }
  async function del(id: string) {
    const agent = agents.find((candidate) => candidate.id === id)
    if (!agent) throw new Error('The selected agent no longer exists.')
    const policyResponse = await fetch(`/api/teams/${encodeURIComponent(agent.teamId)}/policy`)
    if (!policyResponse.ok) {
      throw new Error('The current Team policy is unavailable. Nothing was deleted.')
    }
    const policy = (await policyResponse.json()) as ResolvedTeamPolicy
    const response = await fetch(
      `/api/agents/${encodeURIComponent(id)}?expectedTeamRevision=${policy.teamPolicy.revision}`,
      { method: 'DELETE' },
    )
    if (!response.ok && response.status !== 204) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      throw new Error(body?.error ?? `Could not delete agent (${response.status})`)
    }
    await router.invalidate()
  }

  return (
    <PageShell size="wide">
      <PageHeader
        eyebrow="Workspace"
        title="Agents"
        description="Spawn, inspect, archive, and restore the agents that work across your teams."
        actions={
          <Button
            variant="ghost"
            onClick={() => window.location.assign(showAll ? '/agents' : '/agents?all=1')}
          >
            {showAll ? 'Hide archived' : 'Show archived'}
          </Button>
        }
      />

      <SpawnForm
        profiles={profiles}
        teams={teams}
        modelGroups={modelGroups}
        onSpawned={router.invalidate}
      />

      {actionError && <p role="alert" className="err">{actionError}</p>}

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
            description="Spawn an agent above to give a team its first working member."
          />
        ) : (
          <>
          <div className="hidden overflow-x-auto md:block">
            <table className="min-w-[760px]">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Agent template</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <a href={`/agents/${a.id}`} title={a.id}>
                        <code>{a.id.slice(0, 8)}…</code>
                      </a>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <AgentAvatar identity={a.identity} size={26} />
                        <div className="leading-tight">
                          <div>{a.name}</div>
                          {(a.identity?.creature || a.identity?.vibe) && (
                            <div className="muted text-[0.8em]">
                              {[a.identity?.creature, a.identity?.vibe]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <code>{a.profileId}</code>
                    </td>
                    <td>
                      <StatusBadge variant={a.status === 'archived' ? 'warning' : 'success'}>
                        {a.status}
                      </StatusBadge>
                    </td>
                    <td>
                      <div className="flex justify-end gap-1.5">
                        {a.status !== 'archived' ? (
                          <Button
                            variant="ghost"
                            onClick={() => setPendingAction({ kind: 'archive', agent: a })}
                          >
                            Archive
                          </Button>
                        ) : (
                          <Button variant="ghost" onClick={() => unarchive(a.id)}>
                            Restore
                          </Button>
                        )}
                        <Button
                          variant="danger"
                          onClick={() => setPendingAction({ kind: 'delete', agent: a })}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 md:hidden">
            {agents.map((agent) => (
              <article key={agent.id} className="min-w-0 rounded-xl border border-border bg-muted/20 p-4">
                <div className="flex min-w-0 items-start gap-3">
                  <AgentAvatar identity={agent.identity} size={36} />
                  <div className="min-w-0 flex-1">
                    <a href={`/agents/${agent.id}`} className="block truncate font-semibold text-foreground">
                      {agent.name}
                    </a>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {agent.identity?.creature || agent.identity?.vibe
                        ? [agent.identity?.creature, agent.identity?.vibe].filter(Boolean).join(' · ')
                        : `Agent template: ${agent.profileId}`}
                    </p>
                  </div>
                  <StatusBadge variant={agent.status === 'archived' ? 'warning' : 'success'}>
                    {agent.status}
                  </StatusBadge>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="min-w-0 rounded-lg bg-muted p-2">
                    <dt className="font-semibold text-muted-foreground">ID</dt>
                    <dd className="mt-0.5 truncate font-mono" title={agent.id}>{agent.id.slice(0, 12)}…</dd>
                  </div>
                  <div className="min-w-0 rounded-lg bg-muted p-2">
                    <dt className="font-semibold text-muted-foreground">Agent template</dt>
                    <dd className="mt-0.5 truncate font-mono" title={agent.profileId}>{agent.profileId}</dd>
                  </div>
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">
                  {agent.status === 'archived' ? (
                    <Button variant="ghost" onClick={() => void unarchive(agent.id)}>Restore</Button>
                  ) : (
                    <Button
                      variant="ghost"
                      onClick={() => setPendingAction({ kind: 'archive', agent })}
                    >
                      Archive
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    onClick={() => setPendingAction({ kind: 'delete', agent })}
                  >
                    Delete
                  </Button>
                </div>
              </article>
            ))}
          </div>
          </>
        )}
      </SectionCard>

      <ConfirmDialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null)
        }}
        title={
          pendingAction?.kind === 'delete'
            ? `Delete ${pendingAction.agent.name} permanently?`
            : `Archive ${pendingAction?.agent.name ?? 'agent'}?`
        }
        description={
          pendingAction?.kind === 'delete' ? (
            <p>
              This permanently removes the Agent, its messages, triggers, skill attachments,
              sessions, and private on-disk directory. This cannot be undone.
            </p>
          ) : (
            <p>
              The Agent will stop appearing in current lists and cannot receive normal work.
              You can restore it later from “Show archived”.
            </p>
          )
        }
        confirmLabel={pendingAction?.kind === 'delete' ? 'Delete permanently' : 'Archive agent'}
        confirmVariant={pendingAction?.kind === 'delete' ? 'danger' : 'primary'}
        onConfirm={async () => {
          if (!pendingAction) return
          if (pendingAction.kind === 'delete') await del(pendingAction.agent.id)
          else await archive(pendingAction.agent.id)
        }}
      />
    </PageShell>
  )
}

function SpawnForm({
  profiles,
  teams,
  modelGroups,
  onSpawned,
}: {
  profiles: Profile[]
  teams: Team[]
  modelGroups: ModelGroup[]
  onSpawned: () => void
}) {
  const [profileId, setProfileId] = useState('')
  const [name, setName] = useState('')
  const [model, setModel] = useState('')
  // Default to the seeded 'default' team when present so the form matches the
  // server-side fallback. Empty string means "let the daemon pick" — same end
  // result as picking 'default' explicitly.
  const [teamId, setTeamId] = useState(teams.find((g) => g.id === 'default')?.id ?? '')
  const [placement, setPlacement] = useState<'isolated' | 'profile_defaults'>('profile_defaults')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!profileId) {
      setErr('profile is required')
      return
    }
    setSubmitting(true)
    setErr(null)
    try {
      const body: Record<string, unknown> = { profile: profileId }
      if (name) body.name = name
      if (model) body.model = model
      if (teamId) {
        const policyResponse = await fetch(`/api/teams/${encodeURIComponent(teamId)}/policy`)
        if (!policyResponse.ok) throw new Error('The selected Team policy is unavailable.')
        const current = (await policyResponse.json()) as ResolvedTeamPolicy
        body.teamId = teamId
        body.teamExpectedRevision = current.teamPolicy.revision
        body.placement = placement
      }
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(b?.error ?? res.statusText)
      }
      await res.json()
      // Reset on success.
      setName('')
      setModel('')
      onSpawned()
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <SectionCard
      title="Spawn an agent"
      description="Skills come from the Agent template at spawn time. You can adjust an agent's skills later from its detail page."
    >
      <form onSubmit={submit}>
        {err && <div role="alert" className="err">{err}</div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            Agent template
            <select value={profileId} onChange={(e) => setProfileId(e.target.value)} required>
              <option value="">Select a template</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Model override
            {modelGroups.length === 0 ? (
              <input
                value=""
                disabled
                placeholder="Uses the template default — enable models in Config"
              />
            ) : (
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="">Use the template default</option>
                {modelGroups.map((g) => (
                  <optgroup key={g.provider} label={g.provider}>
                    {g.models.map((m) => (
                      <option key={m} value={`${g.provider}:${m}`}>
                        {`${g.provider}:${m}`}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
          </label>
          <label>
            Team
            {teams.length === 0 ? (
              <select disabled>
                <option>No teams — register one in Teams</option>
              </select>
            ) : (
              <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                {teams.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.id} ({g.name})
                  </option>
                ))}
              </select>
            )}
          </label>
          <label className="sm:col-span-2">
            Initial policy placement
            <select
              value={placement}
              onChange={(e) => setPlacement(e.target.value as typeof placement)}
            >
              <option value="profile_defaults">Agent-template defaults</option>
              <option value="isolated">Isolated</option>
            </select>
            <span className="muted mt-1 block text-xs">
              Submission uses the latest displayed Team revision. A concurrent policy change is
              shown as a conflict and is never overwritten.
            </span>
          </label>
        </div>

        <div className="mt-4">
          <Button variant="primary" type="submit" disabled={submitting}>
            {submitting ? 'Spawning…' : 'Spawn agent'}
          </Button>
        </div>
      </form>
    </SectionCard>
  )
}
