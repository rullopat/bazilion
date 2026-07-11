import type { Group, HarnessTemplateWithCount, ResolvedGroupHarness } from '@bazilion/api-types'
import { useEffect, useRef, useState } from 'react'
import { Button } from './Button'

interface Props {
  profileGroup: HarnessTemplateWithCount
  groups: Group[]
  onClose: () => void
  onSpawned: (groupSlug: string) => void
}

interface SpawnPreview {
  mode: 'initialize' | 'append'
  currentRevision: number | null
  resultingRevision: number
  newMembers: Array<{ slotId: string; agentName: string; profileId: string }>
  edges: Array<{ sourceKind: string; sourceId: string | null; targetKind: string; targetId: string | null }>
}

export function SpawnTeamModal({ profileGroup: team, groups, onClose, onSpawned }: Props) {
  const [groupId, setGroupId] = useState('')
  const [userMd, setUserMd] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<SpawnPreview | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => { dialogRef.current?.focus() }, [])

  async function requestBody() {
    const target = groupId.trim()
    if (!target) throw new Error('target Group slug is required')
    const existing = groups.find((group) => group.id === target)
    let groupExpectedRevision: number | undefined
    if (existing) {
      const policyResponse = await fetch(`/api/groups/${encodeURIComponent(target)}/harness`)
      if (!policyResponse.ok) throw new Error('The target Group policy is unavailable.')
      groupExpectedRevision = ((await policyResponse.json()) as ResolvedGroupHarness).harness.revision
    }
    return { target, body: { templateExpectedRevision: team.currentRevision, groupId: target, ...(groupExpectedRevision ? { groupExpectedRevision } : {}), mode: existing ? 'append' as const : 'initialize' as const, ...(userMd ? { userMd } : {}) } }
  }

  async function review() {
    setBusy(true); setError(null); setPreview(null)
    try {
      const { body } = await requestBody()
      const response = await fetch(`/api/harness-templates/${encodeURIComponent(team.id)}/spawn/preview`, { method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body) })
      if (!response.ok) throw new Error(((await response.json().catch(()=>null)) as {error?:string}|null)?.error ?? response.statusText)
      setPreview(await response.json())
    } catch (cause) { setError((cause as Error).message) } finally { setBusy(false) }
  }

  async function spawn() {
    const target = groupId.trim()
    if (!target) { setError('target Group slug is required'); return }
    setBusy(true); setError(null)
    try {
      const { body } = await requestBody()
      const response = await fetch(`/api/harness-templates/${encodeURIComponent(team.id)}/spawn`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? response.statusText)
      onSpawned(target)
    } catch (cause) { setError((cause as Error).message) } finally { setBusy(false) }
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose} onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}>
      <div ref={dialogRef} tabIndex={-1} className="card w-full max-w-lg" role="document" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key !== 'Escape') event.stopPropagation() }}>
        <h3>spawn team — {team.name}</h3>
        {error && <div className="err">{error}</div>}
        <p className="muted">Uses immutable Team revision {team.currentRevision}. Existing Groups append at their current reviewed revision; a new Group initializes at revision 1. Conflicts never overwrite newer state.</p>
        <label>target Group slug<input value={groupId} onChange={(event) => {setGroupId(event.target.value);setPreview(null)}} list="canonical-groups" required /><datalist id="canonical-groups">{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</datalist></label>
        <label>starter USER.md (new Group only)<textarea rows={3} value={userMd} onChange={(event) => {setUserMd(event.target.value);setPreview(null)}} className="font-mono text-[0.88em] leading-[1.55]" /></label>
        {preview && <div className="mt-4 rounded-md border border-sapphire-light bg-sapphire-glow p-3 text-sm"><p><strong>{preview.mode === 'initialize' ? 'Initialize' : 'Append'}</strong> produces Group revision {preview.resultingRevision}, adds {preview.newMembers.length} Agents, and results in {preview.edges.length} directed allow edges.</p><ul className="mt-2 max-h-40 overflow-auto">{preview.newMembers.map((member)=><li key={member.slotId}>{member.agentName} · stable source slot <code>{member.slotId}</code></li>)}</ul><details className="mt-2"><summary className="cursor-pointer">Review exact edge topology</summary><ul className="mt-2 max-h-40 overflow-auto">{preview.edges.map((edge,index)=><li key={`${edge.sourceKind}:${edge.sourceId??''}>${edge.targetKind}:${edge.targetId??''}:${index}`}><code>{edge.sourceKind}{edge.sourceId?`:${edge.sourceId}`:''} → {edge.targetKind}{edge.targetId?`:${edge.targetId}`:''}</code></li>)}</ul></details></div>}
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>cancel</Button>{preview ? <Button variant="primary" onClick={spawn} disabled={busy}>{busy ? 'spawning…' : `commit ${preview.mode}`}</Button> : <Button variant="primary" onClick={review} disabled={busy || team.slotCount === 0}>{busy ? 'reviewing…' : 'review exact result'}</Button>}</div>
      </div>
    </div>
  )
}
