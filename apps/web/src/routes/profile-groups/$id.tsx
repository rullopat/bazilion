import type {
  Profile,
  ProfileGroupDetail,
  ProfileGroupSlot,
  ReasoningLevel,
} from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { daemonClient } from '../../lib/daemon-client'
import { REASONING_LEVELS } from '../../lib/wire-constants'

interface ModelGroup {
  provider: string
  models: string[]
}

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

interface SlotDraft {
  profileId: string
  agentName: string
  modelOverride: string | null
  reasoningLevel: ReasoningLevel | null
}

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

      <BasicsCard
        group={group}
        onSaved={() => router.invalidate()}
      />

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
  const [groupSlugHint, setGroupSlugHint] = useState(group.groupSlugHint ?? '')
  const [userMd, setUserMd] = useState(group.userMd ?? '')
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    setErr(null)
    setSaving(true)
    try {
      const body: Record<string, unknown> = { name }
      body.groupSlugHint = groupSlugHint.trim() === '' ? null : groupSlugHint.trim()
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
        default target group slug (suggestion; overridable at spawn)
        <input value={groupSlugHint} onChange={(e) => setGroupSlugHint(e.target.value)} />
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
  const [dirty, setDirty] = useState(false)

  function update(i: number, patch: Partial<SlotDraft>) {
    setSlots((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
    setDirty(true)
  }

  function move(i: number, delta: -1 | 1) {
    const j = i + delta
    if (j < 0 || j >= slots.length) return
    setSlots((prev) => {
      const next = [...prev]
      const tmp = next[i]
      const swap = next[j]
      if (!tmp || !swap) return prev
      next[i] = swap
      next[j] = tmp
      return next
    })
    setDirty(true)
  }

  function removeSlot(i: number) {
    setSlots((prev) => prev.filter((_, idx) => idx !== i))
    setDirty(true)
  }

  function addSlot() {
    const firstProfile = profiles[0]
    if (!firstProfile) {
      setErr('create a profile first under /profiles')
      return
    }
    setSlots((prev) => [
      ...prev,
      {
        profileId: firstProfile.id,
        agentName: 'agent',
        modelOverride: null,
        reasoningLevel: null,
      },
    ])
    setDirty(true)
  }

  async function save() {
    setErr(null)
    setSaving(true)
    try {
      const body = {
        slots: slots.map((s) => ({
          profileId: s.profileId,
          agentName: s.agentName,
          modelOverride: s.modelOverride,
          reasoningLevel: s.reasoningLevel,
        })),
      }
      const res = await fetch(`/api/profile-groups/${groupId}/slots`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(e?.error ?? res.statusText)
      }
      setDirty(false)
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
      {slots.length === 0 ? (
        <p className="muted">No slots yet. Add one to define your first team member.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>profile</th>
              <th>agent name</th>
              <th>model override</th>
              <th>reasoning</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {slots.map((s, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are addressed by position; the index IS the key.
              <tr key={i}>
                <td>{i}</td>
                <td>
                  <select
                    value={s.profileId}
                    onChange={(e) => update(i, { profileId: e.target.value })}
                  >
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.id}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    value={s.agentName}
                    onChange={(e) => update(i, { agentName: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    value={s.modelOverride ?? ''}
                    onChange={(e) =>
                      update(i, { modelOverride: e.target.value === '' ? null : e.target.value })
                    }
                  >
                    <option value="">(use profile default)</option>
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
                </td>
                <td>
                  <select
                    value={s.reasoningLevel ?? ''}
                    onChange={(e) =>
                      update(i, {
                        reasoningLevel: e.target.value === '' ? null : (e.target.value as ReasoningLevel),
                      })
                    }
                  >
                    <option value="">(default: medium)</option>
                    {REASONING_LEVELS.map((lvl) => (
                      <option key={lvl} value={lvl}>
                        {lvl}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="flex gap-1">
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    title="move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => move(i, 1)}
                    disabled={i === slots.length - 1}
                    title="move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => removeSlot(i)}
                    title="delete slot"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-3 flex gap-2">
        <button type="button" className="ghost-btn" onClick={addSlot}>
          + add slot
        </button>
        <button type="button" onClick={save} disabled={saving || !dirty}>
          {saving ? 'saving…' : 'save slots'}
        </button>
      </div>
    </div>
  )
}
