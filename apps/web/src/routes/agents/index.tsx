import type { Agent, Team, Profile, ResolvedTeamPolicy } from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { AgentAvatar } from '../../components/AgentAvatar'
import { Button } from '../../components/Button'
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
  .inputValidator((d: { all: boolean }) => d)
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

  async function archive(id: string) {
    if (!confirm('archive this agent? (reversible)')) return
    await fetch(`/api/agents/${id}/archive`, { method: 'POST' })
    await router.invalidate()
  }
  async function unarchive(id: string) {
    await fetch(`/api/agents/${id}/unarchive`, { method: 'POST' })
    await router.invalidate()
  }
  async function del(id: string) {
    if (!confirm('permanently delete this agent and all its data?')) return
    const agent = agents.find((candidate) => candidate.id === id)
    if (!agent) return
    const policyResponse = await fetch(`/api/teams/${encodeURIComponent(agent.teamId)}/policy`)
    if (!policyResponse.ok) return
    const policy = (await policyResponse.json()) as ResolvedTeamPolicy
    await fetch(
      `/api/agents/${encodeURIComponent(id)}?expectedTeamRevision=${policy.teamPolicy.revision}`,
      { method: 'DELETE' },
    )
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
          <div className="overflow-x-auto">
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
                          <Button variant="ghost" onClick={() => archive(a.id)}>
                            Archive
                          </Button>
                        ) : (
                          <Button variant="ghost" onClick={() => unarchive(a.id)}>
                            Restore
                          </Button>
                        )}
                        <Button variant="danger" onClick={() => del(a.id)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
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
        {err && <div className="err">{err}</div>}
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
