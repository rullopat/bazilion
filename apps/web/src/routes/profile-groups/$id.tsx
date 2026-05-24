import type { Profile, ProfileGroupDetail, ProfileGroupSlot } from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { type ModelGroup, type SlotDraft, SlotsEditor } from '../../components/SlotsEditor'
import { daemonClient } from '../../lib/daemon-client'

interface ProfileGroupDetailData {
  detail: ProfileGroupDetail
  profiles: Profile[]
  modelGroups: ModelGroup[]
}

const fetchDetail = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<ProfileGroupDetailData> => {
    const c = daemonClient()
    const [detail, profiles, models] = await Promise.all([
      c.get<ProfileGroupDetail>(`/api/profile-groups/${encodeURIComponent(data.id)}`),
      c.get<Profile[]>('/api/profiles'),
      c.get<{ groups: ModelGroup[] }>('/api/config/available-models'),
    ])
    return { detail, profiles, modelGroups: models.groups }
  })

export const Route = createFileRoute('/profile-groups/$id')({
  loader: ({ params }) => fetchDetail({ data: { id: params.id } }),
  component: ProfileGroupDetailPage,
})

function toDraft(s: ProfileGroupSlot): SlotDraft {
  return {
    profileId: s.profileId,
    agentName: s.agentName,
    modelOverride: s.modelOverride,
    reasoningLevel: s.reasoningLevel,
  }
}

function ProfileGroupDetailPage() {
  const { detail, profiles, modelGroups } = Route.useLoaderData()
  const router = useRouter()
  const { group } = detail

  return (
    <div>
      <h1>{group.name}</h1>
      <p className="muted">
        <code>{group.id}</code> · {detail.slots.length} slot{detail.slots.length === 1 ? '' : 's'}
      </p>

      <BasicsCard group={group} onSaved={() => router.invalidate()} />

      <SlotsCard
        groupId={group.id}
        initialSlots={detail.slots.map(toDraft)}
        profiles={profiles}
        modelGroups={modelGroups}
        onSaved={() => router.invalidate()}
      />
    </div>
  )
}

function BasicsCard({
  group,
  onSaved,
}: {
  group: ProfileGroupDetail['group']
  onSaved: () => void
}) {
  const [name, setName] = useState(group.name)
  const [userMd, setUserMd] = useState(group.userMd ?? '')
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    setErr(null)
    setSaving(true)
    try {
      const body: Record<string, unknown> = { name }
      body.userMd = userMd === '' ? null : userMd
      const res = await fetch(`/api/profile-groups/${group.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(e?.error ?? res.statusText)
      }
      onSaved()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card">
      <h3>basics</h3>
      {err && <div className="err">{err}</div>}
      <label>
        name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        starter USER.md (seeded only into freshly-created target groups)
        <textarea
          rows={6}
          value={userMd}
          onChange={(e) => setUserMd(e.target.value)}
          className="font-mono text-[0.88em] leading-[1.55]"
        />
      </label>
      <button type="button" onClick={save} disabled={saving}>
        {saving ? 'saving…' : 'save basics'}
      </button>
    </div>
  )
}

function SlotsCard({
  groupId,
  initialSlots,
  profiles,
  modelGroups,
  onSaved,
}: {
  groupId: string
  initialSlots: SlotDraft[]
  profiles: Profile[]
  modelGroups: ModelGroup[]
  onSaved: () => void
}) {
  const [slots, setSlots] = useState<SlotDraft[]>(initialSlots)
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(slots) !== JSON.stringify(initialSlots)

  async function save() {
    setErr(null)
    setSaving(true)
    try {
      const res = await fetch(`/api/profile-groups/${groupId}/slots`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slots }),
      })
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(e?.error ?? res.statusText)
      }
      onSaved()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card">
      <h3>slots</h3>
      {err && <div className="err">{err}</div>}
      <p className="muted">
        Each slot becomes one agent at spawn time. Duplicate agent-names within a template are
        fine — the spawn op auto-suffixes collisions with <code>-2</code>, <code>-3</code>, …
      </p>
      <SlotsEditor
        slots={slots}
        onChange={setSlots}
        profiles={profiles}
        modelGroups={modelGroups}
      />
      <div className="mt-3">
        <button type="button" onClick={save} disabled={saving || !dirty}>
          {saving ? 'saving…' : 'save slots'}
        </button>
      </div>
    </div>
  )
}
