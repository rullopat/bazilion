import type { Agent, Team, Profile, ResolvedTeamPolicy } from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { AgentAvatar } from '../../components/AgentAvatar'
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
    <div>
      <h1>agents</h1>

      <SpawnForm
        profiles={profiles}
        teams={teams}
        modelGroups={modelGroups}
        onSpawned={router.invalidate}
      />

      <p>
        <a href={showAll ? '/agents' : '/agents?all=1'}>
          {showAll ? 'hide archived' : 'show archived'}
        </a>
      </p>

      <table>
        <thead>
          <tr>
            <th>id</th>
            <th>name</th>
            <th>profile</th>
            <th>status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {agents.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                no agents yet
              </td>
            </tr>
          )}
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
                        {[a.identity?.creature, a.identity?.vibe].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </div>
                </div>
              </td>
              <td>
                <code>{a.profileId}</code>
              </td>
              <td>{a.status}</td>
              <td>
                <div className="flex gap-1.5">
                  {a.status !== 'archived' ? (
                    <button type="button" className="ghost-btn" onClick={() => archive(a.id)}>
                      archive
                    </button>
                  ) : (
                    <button type="button" className="ghost-btn" onClick={() => unarchive(a.id)}>
                      unarchive
                    </button>
                  )}
                  <button
                    type="button"
                    className="ghost-btn"
                    style={{ color: 'var(--color-rose-baziu)' }}
                    onClick={() => del(a.id)}
                  >
                    delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
  const [placement, setPlacement] = useState<'isolated' | 'open' | 'profile_defaults'>('profile_defaults')
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
    <form className="card" onSubmit={submit}>
      <h3>spawn agent</h3>
      {err && <div className="err">{err}</div>}
      <p className="muted my-2 text-[0.85em]">
        Skills come from the profile's defaults at spawn time. Tweak per-agent skills after the
        fact from the agent detail page.
      </p>
      <div className="flex gap-4">
        <label className="flex-1">
          profile
          <select value={profileId} onChange={(e) => setProfileId(e.target.value)} required>
            <option value="">--</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id}
              </option>
            ))}
          </select>
        </label>
        <label className="flex-1">
          name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      <label>
        model override
        {modelGroups.length === 0 ? (
          <input
            value=""
            disabled
            placeholder="(uses profile default — enable models on /config)"
          />
        ) : (
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">(uses profile default)</option>
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
        team
        {teams.length === 0 ? (
          <select disabled>
            <option>(no teams — register one on /teams)</option>
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
      <label>
        initial policy placement
        <select value={placement} onChange={(e) => setPlacement(e.target.value as typeof placement)}>
          <option value="profile_defaults">agent-template defaults</option>
          <option value="isolated">isolated</option>
          <option value="open">open to current members and boundaries</option>
        </select>
        <span className="muted mt-1 block text-xs">Submit uses the latest displayed Team revision; a concurrent policy change is shown as a conflict and never overwritten.</span>
      </label>

      <button type="submit" disabled={submitting}>
        {submitting ? 'spawning…' : 'spawn'}
      </button>
    </form>
  )
}
