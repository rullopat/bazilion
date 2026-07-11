import type { Group, HarnessTemplateWithCount, ResolvedGroupHarness } from '@bazilion/api-types'
import { useState } from 'react'
import { Button } from './Button'

interface Props {
  profileGroup: HarnessTemplateWithCount
  groups: Group[]
  onClose: () => void
  onSpawned: (groupSlug: string) => void
}

export function SpawnTeamModal({ profileGroup: team, groups, onClose, onSpawned }: Props) {
  const [groupId, setGroupId] = useState('')
  const [userMd, setUserMd] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function spawn() {
    const target = groupId.trim()
    if (!target) { setError('target Group slug is required'); return }
    setBusy(true); setError(null)
    try {
      const existing = groups.find((group) => group.id === target)
      let groupExpectedRevision: number | undefined
      if (existing) {
        const policyResponse = await fetch(`/api/groups/${encodeURIComponent(target)}/harness`)
        if (!policyResponse.ok) throw new Error('The target Group policy is unavailable.')
        groupExpectedRevision = ((await policyResponse.json()) as ResolvedGroupHarness).harness.revision
      }
      const response = await fetch(`/api/harness-templates/${encodeURIComponent(team.id)}/spawn`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          templateExpectedRevision: team.currentRevision,
          groupId: target,
          ...(groupExpectedRevision ? { groupExpectedRevision } : {}),
          mode: existing ? 'append' : 'initialize',
          ...(userMd ? { userMd } : {}),
        }),
      })
      if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? response.statusText)
      onSpawned(target)
    } catch (cause) { setError((cause as Error).message) } finally { setBusy(false) }
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose} onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}>
      <div className="card w-full max-w-lg" role="document" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        <h3>spawn team — {team.name}</h3>
        {error && <div className="err">{error}</div>}
        <p className="muted">Uses immutable Team revision {team.currentRevision}. Existing Groups append at their current reviewed revision; a new Group initializes at revision 1. Conflicts never overwrite newer state.</p>
        <label>target Group slug<input value={groupId} onChange={(event) => setGroupId(event.target.value)} list="canonical-groups" required /><datalist id="canonical-groups">{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</datalist></label>
        <label>starter USER.md (new Group only)<textarea rows={3} value={userMd} onChange={(event) => setUserMd(event.target.value)} className="font-mono text-[0.88em] leading-[1.55]" /></label>
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>cancel</Button><Button variant="primary" onClick={spawn} disabled={busy || team.slotCount === 0}>{busy ? 'spawning…' : 'review and spawn'}</Button></div>
      </div>
    </div>
  )
}
