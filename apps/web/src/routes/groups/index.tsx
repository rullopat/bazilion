import type { Agent, Group } from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { daemonClient } from '../../lib/daemon-client'

interface GroupsData {
  groups: Group[]
  memberCounts: Record<string, number>
}

const fetchGroupsData = createServerFn({ method: 'GET' }).handler(
  async (): Promise<GroupsData> => {
    const c = daemonClient()
    const [groups, agents] = await Promise.all([
      c.get<Group[]>('/api/groups'),
      c.get<Agent[]>('/api/agents?includeArchived=true'),
    ])
    const memberCounts: Record<string, number> = {}
    for (const a of agents) memberCounts[a.groupId] = (memberCounts[a.groupId] ?? 0) + 1
    return { groups, memberCounts }
  },
)

export const Route = createFileRoute('/groups/')({
  loader: () => fetchGroupsData(),
  component: GroupsPage,
})

function GroupsPage() {
  const { groups, memberCounts } = Route.useLoaderData()
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
        A group is a collaboration context: one filesystem root, one USER.md, one roster. Every
        agent belongs to exactly one group.
      </p>

      <RegisterGroupForm onRegistered={() => router.invalidate()} />

      <table>
        <thead>
          <tr>
            <th>id</th>
            <th>name</th>
            <th>path</th>
            <th>members</th>
            <th>USER.md</th>
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
            const userMdBytes = g.userMd.length
            return (
              <tr key={g.id}>
                <td>
                  <code>{g.id}</code>
                </td>
                <td>{g.name}</td>
                <td>
                  <code>{g.path}</code>
                </td>
                <td>{count}</td>
                <td>
                  <a href={`/groups/${g.id}`}>
                    {userMdBytes > 0 ? `${userMdBytes} chars` : 'empty'}
                  </a>
                </td>
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
