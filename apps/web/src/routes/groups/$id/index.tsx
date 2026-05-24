import { ApiClientError } from '@bazilion/client'
import type {
  Agent,
  Group,
  ProfileGroupWithCount,
  SpawnProfileGroupResponse,
} from '@bazilion/api-types'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { daemonClient } from '../../../lib/daemon-client'

interface GroupDetail {
  group: Group
  members: Agent[]
  profileGroups: ProfileGroupWithCount[]
}

const fetchGroup = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<GroupDetail | null> => {
    const c = daemonClient()
    let group: Group
    try {
      group = await c.get<Group>(`/api/groups/${encodeURIComponent(data.id)}`)
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 404) return null
      throw err
    }
    const [all, profileGroups] = await Promise.all([
      c.get<Agent[]>('/api/agents?includeArchived=true'),
      c.get<ProfileGroupWithCount[]>('/api/profile-groups'),
    ])
    const members = all.filter((a) => a.groupId === group.id)
    return { group, members, profileGroups }
  })

export const Route = createFileRoute('/groups/$id/')({
  loader: async ({ params }) => {
    const data = await fetchGroup({ data: { id: params.id } })
    if (!data) throw redirect({ to: '/groups' })
    return data
  },
  component: GroupDetailPage,
})

function GroupDetailPage() {
  const { group, members, profileGroups } = Route.useLoaderData()
  const router = useRouter()
  const [userMd, setUserMd] = useState(group.userMd)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  async function save() {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/groups/${encodeURIComponent(group.id)}/user-md`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userMd }),
      })
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(e.error ?? `${res.status} ${res.statusText}`)
      }
      setSavedAt(Date.now())
      await router.invalidate()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="font-serif text-3xl text-foreground">
        {group.name} <span className="text-muted-foreground text-base">({group.id})</span>
      </h1>
      <p className="text-muted-foreground text-sm mb-6 mt-1">
        <code className="font-mono">{group.path}</code> · {members.length}{' '}
        member{members.length === 1 ? '' : 's'} ·{' '}
        <a
          href={`/groups/${encodeURIComponent(group.id)}/memory`}
          className="text-primary underline"
        >
          shared memory →
        </a>
      </p>

      <section className="rounded-lg border bg-card p-5 mb-6">
        <h3 className="font-serif text-xl mb-1">USER.md</h3>
        <p className="text-muted-foreground text-sm mb-3">
          Read-only context about the human, injected into every member agent's system prompt.
          12 KB cap. Agents cannot edit this file — only you can.
        </p>
        <textarea
          value={userMd}
          onChange={(e) => setUserMd(e.target.value)}
          rows={16}
          className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring/30"
          placeholder="What the agent should know about you in this group context…"
        />
        <div className="flex items-center gap-3 mt-3">
          <button
            type="button"
            onClick={save}
            disabled={busy || userMd === group.userMd}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? 'saving…' : 'save'}
          </button>
          <span className="text-xs text-muted-foreground">
            {userMd.length} / 12000 chars
          </span>
          {savedAt && <span className="text-xs text-emerald-700">✓ saved</span>}
          {err && <span className="text-xs text-rose-700">{err}</span>}
        </div>
      </section>

      {members.length === 0 && (
        <SpawnFromTemplateCard
          groupId={group.id}
          profileGroups={profileGroups}
          onSpawned={() => router.invalidate()}
        />
      )}

      <section className="rounded-lg border bg-card p-5">
        <h3 className="font-serif text-xl mb-3">members</h3>
        {members.length === 0 ? (
          <p className="text-muted-foreground text-sm">No agents in this group yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground border-b">
              <tr>
                <th className="py-2">name</th>
                <th>status</th>
                <th>profile</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b last:border-0">
                  <td className="py-2">
                    <a href={`/agents/${m.id}`} className="text-primary underline">
                      {m.name}
                    </a>
                  </td>
                  <td>{m.status}</td>
                  <td>
                    <code className="font-mono text-xs">{m.profileId}</code>
                  </td>
                  <td>
                    <code className="font-mono text-xs text-muted-foreground">
                      {m.id.slice(0, 8)}…
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}

function SpawnFromTemplateCard({
  groupId,
  profileGroups,
  onSpawned,
}: {
  groupId: string
  profileGroups: ProfileGroupWithCount[]
  onSpawned: () => void
}) {
  const eligible = profileGroups.filter((g) => g.slotCount > 0)
  const [selected, setSelected] = useState<string>(eligible[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function spawn() {
    if (!selected) return
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/profile-groups/${encodeURIComponent(selected)}/spawn`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupSlug: groupId }),
      })
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(e.error ?? `${res.status} ${res.statusText}`)
      }
      const result = (await res.json()) as SpawnProfileGroupResponse
      if (result.orphanAgentIds && result.orphanAgentIds.length > 0) {
        alert(
          `Spawn completed with warnings: ${result.orphanAgentIds.length} orphan agent dir(s) left on disk.`,
        )
      }
      onSpawned()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-lg border bg-card p-5 mb-6">
      <h3 className="font-serif text-xl mb-1">spawn a team into this group</h3>
      <p className="text-muted-foreground text-sm mb-3">
        This group is empty. Pick a profile group template to spawn its entire roster into it in one
        transactional call.
      </p>
      {eligible.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No profile groups with slots yet. Build one on{' '}
          <a href="/profile-groups" className="text-primary underline">
            /profile-groups
          </a>{' '}
          first.
        </p>
      ) : (
        <div className="flex items-center gap-3">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
          >
            {eligible.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.slotCount} slot{g.slotCount === 1 ? '' : 's'})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={spawn}
            disabled={busy || !selected}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? 'spawning…' : 'spawn team'}
          </button>
          {err && <span className="text-xs text-rose-700">{err}</span>}
        </div>
      )}
    </section>
  )
}
