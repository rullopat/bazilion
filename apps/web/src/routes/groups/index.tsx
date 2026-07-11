import type { Agent, Group, HealthReport, ResolvedGroupHarness } from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { RecoveryState } from '../../components/RecoveryState'
import { daemonClient } from '../../lib/daemon-client'

interface GroupsData {
  groups: Group[]
  memberCounts: Record<string, number>
  policies: Record<string, { revision: number; mode: string; baseline: string | null; edges: number }>
  readiness: HealthReport['harnessManagement']
}

const fetchGroupsData = createServerFn({ method: 'GET' }).handler(
  async (): Promise<GroupsData> => {
    const c = daemonClient()
    const [groups, agents, health] = await Promise.all([
      c.get<Group[]>('/api/groups'),
      c.get<Agent[]>('/api/agents?includeArchived=true'),
      c.get<HealthReport>('/api/health'),
    ])
    const memberCounts: Record<string, number> = {}
    for (const a of agents) memberCounts[a.groupId] = (memberCounts[a.groupId] ?? 0) + 1
    const policies: GroupsData['policies'] = {}
    await Promise.all(groups.map(async (group) => {
      const detail = await c.get<ResolvedGroupHarness>(`/api/groups/${encodeURIComponent(group.id)}/harness`)
      policies[group.id] = {
        revision: detail.harness.revision,
        mode: detail.harness.membershipMode,
        baseline: detail.baseline ? `${detail.baseline.templateId} r${detail.baseline.templateRevision}` : null,
        edges: detail.edges.length,
      }
    }))
    return { groups, memberCounts, policies, readiness: health.harnessManagement }
  },
)

export const Route = createFileRoute('/groups/')({
  loader: () => fetchGroupsData(),
  component: GroupsPage,
  errorComponent: ({ error, reset }) => <RecoveryState title="Groups unavailable" error={error} reset={reset} fallbackHref="/" />,
})

function GroupsPage() {
  const { groups, memberCounts, policies, readiness } = Route.useLoaderData()
  const router = useRouter()

  async function remove(id: string) {
    if (!confirm('remove this group registration?')) return
    const res = await fetch(`/api/groups/${id}`, { method: 'DELETE' })
    if (!res.ok && res.status !== 204) {
      alert(res.statusText)
      return
    }
    await router.invalidate()
  }

  return (
    <div>
      <h1>groups</h1>
      <p className="muted">
        A Group owns one workspace, one live membership roster, and exactly one effective policy.
        Every agent belongs to exactly one Group.
      </p>

      <aside className="card" aria-label="Harness enforcement readiness">
        <strong>Policy enforcement remains release-disabled.</strong>{' '}
        <span className="muted">Management contract v{readiness.contractVersion}; BAZ-017 must complete recovery and visual acceptance before activation.</span>
      </aside>

      <RegisterGroupForm onRegistered={() => router.invalidate()} />

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
          {groups.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                no groups registered
              </td>
            </tr>
          )}
          {groups.map((g) => {
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
                  <a href={`/groups/${g.id}/policy`}>
                    {policy ? `r${policy.revision} · ${policy.mode} · ${policy.edges} edges` : 'unavailable'}
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
                      title={`${count} agent(s) belong to this group`}
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
  )
}

function RegisterGroupForm({ onRegistered }: { onRegistered: () => void }) {
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
      const res = await fetch('/api/groups', {
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
      <h3>register group</h3>
      {err && <div className="err">{err}</div>}
      <p className="muted">
        Groups always live under <code>~/.bazilion/groups/&lt;slug&gt;/</code>. Leave the link
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
