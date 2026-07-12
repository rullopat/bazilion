import type { Agent, Team, HealthReport, ResolvedTeamPolicy } from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { RecoveryState } from '../../components/RecoveryState'
import { daemonClient } from '../../lib/daemon-client'

interface TeamsData {
  teams: Team[]
  memberCounts: Record<string, number>
  policies: Record<string, { revision: number; baseline: string | null; edges: number }>
  readiness: HealthReport['teamPolicyManagement']
}

const fetchTeamsData = createServerFn({ method: 'GET' }).handler(
  async (): Promise<TeamsData> => {
    const c = daemonClient()
    const [teams, agents, health] = await Promise.all([
      c.get<Team[]>('/api/teams'),
      c.get<Agent[]>('/api/agents?includeArchived=true'),
      c.get<HealthReport>('/api/health'),
    ])
    const memberCounts: Record<string, number> = {}
    for (const a of agents) memberCounts[a.teamId] = (memberCounts[a.teamId] ?? 0) + 1
    const policies: TeamsData['policies'] = {}
    await Promise.all(teams.map(async (team) => {
      const detail = await c.get<ResolvedTeamPolicy>(`/api/teams/${encodeURIComponent(team.id)}/policy`)
      policies[team.id] = {
        revision: detail.teamPolicy.revision,
        baseline: detail.baseline ? `${detail.baseline.templateId} r${detail.baseline.templateRevision}` : null,
        edges: detail.edges.length,
      }
    }))
    return { teams, memberCounts, policies, readiness: health.teamPolicyManagement }
  },
)

export const Route = createFileRoute('/teams/')({
  loader: () => fetchTeamsData(),
  component: TeamsPage,
  errorComponent: ({ error, reset }) => <RecoveryState title="Teams unavailable" error={error} reset={reset} fallbackHref="/" />,
})

function TeamsPage() {
  const { teams, memberCounts, policies, readiness } = Route.useLoaderData()
  const router = useRouter()

  async function remove(id: string) {
    if (!confirm('remove this team registration?')) return
    const revision = policies[id]?.revision
    if (!revision) return
    const res = await fetch(
      `/api/teams/${encodeURIComponent(id)}?expectedTeamPolicyRevision=${revision}`,
      { method: 'DELETE' },
    )
    if (!res.ok && res.status !== 204) {
      alert(res.statusText)
      return
    }
    await router.invalidate()
  }

  return (
    <div>
      <h1>teams</h1>
      <p className="muted">
        A Team owns one workspace, one live membership roster, and exactly one effective policy.
        Every agent belongs to exactly one Team.
      </p>

      <aside className="card" aria-label="TeamPolicy enforcement readiness">
        <strong>
          {readiness.enforcementActive
            ? 'Team Policy enforcement is active.'
            : 'Team Policy enforcement is currently off.'}
        </strong>{' '}
        <span className="muted">
          Management contract v{readiness.contractVersion} is release-ready. Set{' '}
          <code>BAZILION_TEAM_POLICY_ENFORCEMENT=on</code> and restart the daemon to enforce it.
        </span>
      </aside>

      <RegisterTeamForm onRegistered={() => router.invalidate()} />

      <div className="overflow-x-auto">
        <table>
        <thead>
          <tr>
            <th>id</th>
            <th>name</th>
            <th>members</th>
            <th>policy</th>
            <th>baseline</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {teams.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                no teams registered
              </td>
            </tr>
          )}
          {teams.map((g) => {
            const count = memberCounts[g.id] ?? 0
            const policy = policies[g.id]
            return (
              <tr key={g.id}>
                <td>
                  <code>{g.id}</code>
                </td>
                <td>{g.name}</td>
                <td>{count}</td>
                <td>
                  <a href={`/teams/${g.id}/policy`}>
                    {policy ? `r${policy.revision} · ${policy.edges} edges` : 'unavailable'}
                  </a>
                </td>
                <td>{policy?.baseline ?? 'none'}</td>
                <td>
                  {count === 0 ? (
                    <button type="button" className="ghost-btn" onClick={() => remove(g.id)}>
                      remove
                    </button>
                  ) : (
                    <span
                      className="muted"
                      title={`${count} agent(s) belong to this team`}
                    >
                      in use
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
        </table>
      </div>
    </div>
  )
}

function RegisterTeamForm({ onRegistered }: { onRegistered: () => void }) {
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [link, setLink] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErr(null)
    if (!id.trim()) {
      setErr('id is required')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: id.trim(),
          name: name.trim() || undefined,
          link: link.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const e2 = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(e2?.error ?? res.statusText)
      }
      setId('')
      setName('')
      setLink('')
      onRegistered()
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h3>register team</h3>
      {err && <div className="err">{err}</div>}
      <p className="muted">
        Teams always live under <code>~/.bazilion/teams/&lt;slug&gt;/</code>. Leave the link
        target blank to create a fresh directory; supply an absolute path to materialize the slot
        as a symlink to your existing project tree instead.
      </p>
      <div className="flex gap-4">
        <label className="flex-1">
          id (slug)
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            required
            placeholder="myproject"
          />
        </label>
        <label className="flex-1">
          name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Project" />
        </label>
      </div>
      <label>
        link target (optional, absolute path)
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="/home/user/projects/myproject"
        />
      </label>
      <button type="submit" disabled={submitting}>
        {submitting ? 'registering…' : 'register'}
      </button>
    </form>
  )
}
