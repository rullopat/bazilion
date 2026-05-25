// Spawn a profile group (team template) into a target group. POSTs to
// /api/profile-groups/:id/spawn (proxied to daemon) and hands the resulting
// group slug back to the caller for navigation.

import type {
  Group,
  ProfileGroupWithCount,
  SpawnProfileGroupResponse,
} from '@bazilion/api-types'
import { useState } from 'react'
import { Button } from './Button'

interface Props {
  profileGroup: ProfileGroupWithCount
  groups: Group[]
  onClose: () => void
  onSpawned: (groupSlug: string) => void
}

export function SpawnTeamModal({ profileGroup, groups, onClose, onSpawned }: Props) {
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
          Spawns {profileGroup.memberCount} agent{profileGroup.memberCount === 1 ? '' : 's'} into
          the target group. If the group doesn't exist, it'll be created on the fly. Failures roll
          back the whole spawn.
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
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
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
          <Button variant="ghost" onClick={onClose}>
            cancel
          </Button>
          <Button variant="primary" onClick={spawn} disabled={submitting}>
            {submitting ? 'spawning…' : 'spawn team'}
          </Button>
        </div>
      </div>
    </div>
  )
}
