import type { Group, Profile, ProfileGroupWithCount } from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { Button } from '../../components/Button'
import { type MemberDraft, MembersEditor, type ModelGroup } from '../../components/MembersEditor'
import { SpawnTeamModal } from '../../components/SpawnTeamModal'
import { TemplatesTabs } from '../../components/TemplatesTabs'
import { daemonClient } from '../../lib/daemon-client'

interface ProfileGroupsData {
  profileGroups: ProfileGroupWithCount[]
  groups: Group[]
  profiles: Profile[]
  modelGroups: ModelGroup[]
  /** Built-in DEFAULT_USER_MD, used to prefill the create form's starter USER.md. */
  userMdDefault: string
}

const fetchProfileGroupsData = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ProfileGroupsData> => {
    const c = daemonClient()
    const [profileGroups, groups, profiles, models, templates] = await Promise.all([
      c.get<ProfileGroupWithCount[]>('/api/profile-groups'),
      c.get<Group[]>('/api/groups'),
      c.get<Profile[]>('/api/profiles'),
      c.get<{ groups: ModelGroup[] }>('/api/config/available-models'),
      c.get<{ userMd: string }>('/api/profiles/_/templates'),
    ])
    return {
      profileGroups,
      groups,
      profiles,
      modelGroups: models.groups,
      userMdDefault: templates.userMd,
    }
  },
)

export const Route = createFileRoute('/profile-groups/')({
  loader: () => fetchProfileGroupsData(),
  component: ProfileGroupsPage,
})

function ProfileGroupsPage() {
  const { profileGroups, groups, profiles, modelGroups, userMdDefault } = Route.useLoaderData()
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
        A profile group is a reusable team template. Each one holds an ordered list of members —
        profile + agent-name + optional overrides — that get replayed as a single transactional
        spawn into a target group.
      </p>

      <CreateProfileGroupForm
        profiles={profiles}
        modelGroups={modelGroups}
        userMdDefault={userMdDefault}
        onCreated={() => router.invalidate()}
      />

      <table>
        <thead>
          <tr>
            <th>id</th>
            <th>name</th>
            <th>members</th>
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
              <td>{g.memberCount}</td>
              <td className="flex gap-2">
                <Button
                  variant="primary"
                  disabled={g.memberCount === 0}
                  title={
                    g.memberCount === 0 ? 'add at least one member before spawning' : undefined
                  }
                  onClick={() => setSpawningId(g.id)}
                >
                  spawn team
                </Button>
                <Button variant="danger" onClick={() => del(g.id)}>
                  delete
                </Button>
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
  userMdDefault,
  onCreated,
}: {
  profiles: Profile[]
  modelGroups: ModelGroup[]
  userMdDefault: string
  onCreated: () => void
}) {
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  // Prefill with the built-in starter USER.md (default-on for new groups).
  const [userMd, setUserMd] = useState(userMdDefault)
  const [members, setMembers] = useState<MemberDraft[]>([])
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
      // If members were configured in the form, send them as a follow-up PUT.
      // The two-call shape mirrors the API contract (POST creates basics, PUT
      // /members replaces the array) and keeps the route surface narrow.
      if (members.length > 0) {
        const membersRes = await fetch(`/api/profile-groups/${id.trim()}/members`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ members }),
        })
        if (!membersRes.ok) {
          const e2 = (await membersRes.json().catch(() => null)) as { error?: string } | null
          throw new Error(
            `group created, member save failed: ${e2?.error ?? membersRes.statusText}`,
          )
        }
      }
      setId('')
      setName('')
      setUserMd(userMdDefault)
      setMembers([])
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
        starter USER.md (seeded into freshly-created target groups; prefilled with the built-in
        default — edit to customise)
        <textarea
          rows={3}
          value={userMd}
          onChange={(e) => setUserMd(e.target.value)}
          className="font-mono text-[0.88em] leading-[1.55]"
        />
      </label>
      <div className="mt-4">
        <h4 className="mb-1 text-[0.95em] font-medium">members</h4>
        <p className="muted mb-2 text-[0.88em]">
          Each member becomes one agent when the team is spawned. You can also configure members
          later from the detail page.{' '}
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
        <MembersEditor
          members={members}
          onChange={setMembers}
          profiles={profiles}
          modelGroups={modelGroups}
          emptyHint="No members configured yet — add one to pick a profile for each team member."
        />
      </div>
      <div className="mt-4">
        <Button variant="primary" type="submit" disabled={submitting}>
          {submitting ? 'creating…' : 'create'}
        </Button>
      </div>
    </form>
  )
}

