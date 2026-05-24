import type {
  Group,
  Profile,
  ProfileGroupWithCount,
  SpawnProfileGroupResponse,
} from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { type ModelGroup, type SlotDraft, SlotsEditor } from '../../components/SlotsEditor'
import { TemplatesTabs } from '../../components/TemplatesTabs'
import { daemonClient } from '../../lib/daemon-client'

interface ProfileGroupsData {
  profileGroups: ProfileGroupWithCount[]
  groups: Group[]
  profiles: Profile[]
  modelGroups: ModelGroup[]
}

const fetchProfileGroupsData = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ProfileGroupsData> => {
    const c = daemonClient()
    const [profileGroups, groups, profiles, models] = await Promise.all([
      c.get<ProfileGroupWithCount[]>('/api/profile-groups'),
      c.get<Group[]>('/api/groups'),
      c.get<Profile[]>('/api/profiles'),
      c.get<{ groups: ModelGroup[] }>('/api/config/available-models'),
    ])
    return { profileGroups, groups, profiles, modelGroups: models.groups }
  },
)

export const Route = createFileRoute('/profile-groups/')({
  loader: () => fetchProfileGroupsData(),
  component: ProfileGroupsPage,
})

function ProfileGroupsPage() {
  const { profileGroups, groups, profiles, modelGroups } = Route.useLoaderData()
  const router = useRouter()
  const [spawningId, setSpawningId] = useState<string | null>(null)

  async function del(id: string) {
    if (!confirm('delete this profile group? (does not affect spawned agents)')) return
    const res = await fetch(`/api/profile-groups/${id}`, { method: 'DELETE' })
    if (!res.ok && res.status !== 204) {
      const e = (await res.json().catch(() => null)) as { error?: string } | null
      alert(e?.error ?? res.statusText)
      return
    }
    await router.invalidate()
  }

  return (
    <div>
      <TemplatesTabs />
      <h1>profile groups</h1>
      <p className="muted">
        A profile group is a reusable team template. Each one holds an ordered list of slots —
        profile + agent-name + optional overrides — that get replayed as a single transactional
        spawn into a target group.
      </p>

      <CreateProfileGroupForm
        profiles={profiles}
        modelGroups={modelGroups}
        onCreated={() => router.invalidate()}
      />

      <table>
        <thead>
          <tr>
            <th>id</th>
            <th>name</th>
            <th>slots</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {profileGroups.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                no profile groups yet
              </td>
            </tr>
          )}
          {profileGroups.map((g) => (
            <tr key={g.id}>
              <td>
                <a href={`/profile-groups/${g.id}`}>
                  <code>{g.id}</code>
                </a>
              </td>
              <td>{g.name}</td>
              <td>{g.slotCount}</td>
              <td className="flex gap-2">
                <button
                  type="button"
                  disabled={g.slotCount === 0}
                  title={g.slotCount === 0 ? 'add at least one slot before spawning' : undefined}
                  onClick={() => setSpawningId(g.id)}
                >
                  spawn team
                </button>
                <button type="button" className="ghost-btn" onClick={() => del(g.id)}>
                  delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {spawningId && (
        <SpawnTeamModal
          profileGroup={profileGroups.find((g) => g.id === spawningId)!}
          groups={groups}
          onClose={() => setSpawningId(null)}
          onSpawned={(slug) => {
            setSpawningId(null)
            router.navigate({ to: '/groups/$id', params: { id: slug } })
          }}
        />
      )}
    </div>
  )
}

function CreateProfileGroupForm({
  profiles,
  modelGroups,
  onCreated,
}: {
  profiles: Profile[]
  modelGroups: ModelGroup[]
  onCreated: () => void
}) {
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [userMd, setUserMd] = useState('')
  const [slots, setSlots] = useState<SlotDraft[]>([])
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
      const createBody: Record<string, unknown> = { id: id.trim() }
      if (name.trim()) createBody.name = name.trim()
      if (userMd) createBody.userMd = userMd
      const createRes = await fetch('/api/profile-groups', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(createBody),
      })
      if (!createRes.ok) {
        const e2 = (await createRes.json().catch(() => null)) as { error?: string } | null
        throw new Error(e2?.error ?? createRes.statusText)
      }
      // If slots were configured in the form, send them as a follow-up PUT.
      // The two-call shape mirrors the API contract (POST creates basics, PUT
      // /slots replaces the array) and keeps the route surface narrow.
      if (slots.length > 0) {
        const slotsRes = await fetch(`/api/profile-groups/${id.trim()}/slots`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ slots }),
        })
        if (!slotsRes.ok) {
          const e2 = (await slotsRes.json().catch(() => null)) as { error?: string } | null
          throw new Error(`group created, slot save failed: ${e2?.error ?? slotsRes.statusText}`)
        }
      }
      setId('')
      setName('')
      setUserMd('')
      setSlots([])
      onCreated()
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h3>create profile group</h3>
      {err && <div className="err">{err}</div>}
      <div className="flex gap-4">
        <label className="flex-1">
          id (slug)
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            required
            placeholder="platform-team"
          />
        </label>
        <label className="flex-1">
          name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Platform Team"
          />
        </label>
      </div>
      <label>
        starter USER.md (optional — only seeded into freshly-created target groups)
        <textarea
          rows={3}
          value={userMd}
          onChange={(e) => setUserMd(e.target.value)}
          className="font-mono text-[0.88em] leading-[1.55]"
        />
      </label>
      <div className="mt-4">
        <h4 className="mb-1 text-[0.95em] font-medium">slots</h4>
        <p className="muted mb-2 text-[0.88em]">
          Each slot becomes one agent when the team is spawned. You can also configure slots later
          from the detail page.{' '}
          {profiles.length > 0 && (
            <>
              Available profiles:{' '}
              {profiles.map((p, i) => (
                <span key={p.id}>
                  {i > 0 && ', '}
                  <code>{p.id}</code>
                </span>
              ))}
              .
            </>
          )}
        </p>
        <SlotsEditor
          slots={slots}
          onChange={setSlots}
          profiles={profiles}
          modelGroups={modelGroups}
          emptyHint="No slots configured yet — add one to pick a profile for each team member."
        />
      </div>
      <div className="mt-4">
        <button type="submit" disabled={submitting}>
          {submitting ? 'creating…' : 'create'}
        </button>
      </div>
    </form>
  )
}

function SpawnTeamModal({
  profileGroup,
  groups,
  onClose,
  onSpawned,
}: {
  profileGroup: ProfileGroupWithCount
  groups: Group[]
  onClose: () => void
  onSpawned: (groupSlug: string) => void
}) {
  const [groupSlug, setGroupSlug] = useState('')
  const [userMd, setUserMd] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function spawn() {
    setErr(null)
    if (!groupSlug.trim()) {
      setErr('target group slug is required')
      return
    }
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = { groupSlug: groupSlug.trim() }
      if (userMd) body.userMd = userMd
      const res = await fetch(`/api/profile-groups/${profileGroup.id}/spawn`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(e?.error ?? res.statusText)
      }
      const result = (await res.json()) as SpawnProfileGroupResponse
      if (result.orphanAgentIds && result.orphanAgentIds.length > 0) {
        alert(
          `Spawn completed with warnings: ${result.orphanAgentIds.length} orphan agent dir(s) left on disk.`,
        )
      }
      onSpawned(result.groupSlug)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div
        className="card w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="document"
      >
        <h3>spawn team — {profileGroup.name}</h3>
        {err && <div className="err">{err}</div>}
        <p className="muted">
          Spawns {profileGroup.slotCount} agent{profileGroup.slotCount === 1 ? '' : 's'} into the
          target group. If the group doesn't exist, it'll be created on the fly. Failures roll back
          the whole spawn.
        </p>
        <label>
          target group slug
          <input
            value={groupSlug}
            onChange={(e) => setGroupSlug(e.target.value)}
            list="existing-groups"
            required
          />
          <datalist id="existing-groups">
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </datalist>
        </label>
        <label>
          override USER.md (optional — only takes effect on a freshly-created target group)
          <textarea
            rows={3}
            value={userMd}
            onChange={(e) => setUserMd(e.target.value)}
            className="font-mono text-[0.88em] leading-[1.55]"
          />
        </label>
        <div className="mt-4 flex gap-2 justify-end">
          <button type="button" className="ghost-btn" onClick={onClose}>
            cancel
          </button>
          <button type="button" onClick={spawn} disabled={submitting}>
            {submitting ? 'spawning…' : 'spawn team'}
          </button>
        </div>
      </div>
    </div>
  )
}
