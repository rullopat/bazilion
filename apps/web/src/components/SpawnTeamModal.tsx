import type { Team, TeamTemplateWithCount, ResolvedTeamPolicy } from '@bazilion/api-types'
import { useEffect, useRef, useState } from 'react'
import { Button } from './Button'

interface Props {
  profileGroup: TeamTemplateWithCount
  teams: Team[]
  onClose: () => void
  onSpawned: (teamSlug: string) => void
}

interface SpawnPreview {
  mode: 'initialize' | 'append'
  currentRevision: number | null
  resultingRevision: number
  newMembers: Array<{ slotId: string; agentName: string; profileId: string }>
  edges: Array<{ sourceKind: string; sourceId: string | null; targetKind: string; targetId: string | null }>
}

export function SpawnTeamModal({ profileGroup: team, teams, onClose, onSpawned }: Props) {
  const [teamId, setTeamId] = useState('')
  const [userMd, setUserMd] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<SpawnPreview | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => { dialogRef.current?.focus() }, [])

  async function requestBody() {
    const target = teamId.trim()
    if (!target) throw new Error('target Team slug is required')
    const existing = teams.find((team) => team.id === target)
    let teamExpectedRevision: number | undefined
    if (existing) {
      const policyResponse = await fetch(`/api/teams/${encodeURIComponent(target)}/policy`)
      if (!policyResponse.ok) throw new Error('The target Team policy is unavailable.')
      teamExpectedRevision = ((await policyResponse.json()) as ResolvedTeamPolicy).teamPolicy.revision
    }
    return { target, body: { templateExpectedRevision: team.currentRevision, teamId: target, ...(teamExpectedRevision ? { teamExpectedRevision } : {}), mode: existing ? 'append' as const : 'initialize' as const, ...(userMd ? { userMd } : {}) } }
  }

  async function review() {
    setBusy(true); setError(null); setPreview(null)
    try {
      const { body } = await requestBody()
      const response = await fetch(`/api/team-templates/${encodeURIComponent(team.id)}/spawn/preview`, { method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body) })
      if (!response.ok) throw new Error(((await response.json().catch(()=>null)) as {error?:string}|null)?.error ?? response.statusText)
      setPreview(await response.json())
    } catch (cause) { setError((cause as Error).message) } finally { setBusy(false) }
  }

  async function spawn() {
    const target = teamId.trim()
    if (!target) { setError('target Team slug is required'); return }
    setBusy(true); setError(null)
    try {
      const { body } = await requestBody()
      const response = await fetch(`/api/team-templates/${encodeURIComponent(team.id)}/spawn`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? response.statusText)
      onSpawned(target)
    } catch (cause) { setError((cause as Error).message) } finally { setBusy(false) }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="spawn-team-title" className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/45 p-4 backdrop-blur-sm" onClick={onClose} onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}>
      <div ref={dialogRef} tabIndex={-1} className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-3xl border border-frost bg-card p-6 shadow-baziu-lg sm:p-7" role="document" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key !== 'Escape') event.stopPropagation() }}>
        <h2 id="spawn-team-title">Spawn team — {team.name}</h2>
        {error && <div className="err">{error}</div>}
        <p className="muted">Uses immutable Team revision {team.currentRevision}. Existing Teams append at their current reviewed revision; a new Team initializes at revision 1. Conflicts never overwrite newer state.</p>
        <label>target Team slug<input value={teamId} onChange={(event) => {setTeamId(event.target.value);setPreview(null)}} list="canonical-teams" required /><datalist id="canonical-teams">{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</datalist></label>
        <label>starter USER.md (new Team only)<textarea rows={3} value={userMd} onChange={(event) => {setUserMd(event.target.value);setPreview(null)}} className="font-mono text-[0.88em] leading-[1.55]" /></label>
        {preview && <div className="mt-4 rounded-md border border-sapphire-light bg-sapphire-glow p-3 text-sm"><p><strong>{preview.mode === 'initialize' ? 'Initialize' : 'Append'}</strong> produces Team revision {preview.resultingRevision}, adds {preview.newMembers.length} Agents, and results in {preview.edges.length} directed allow edges.</p><ul className="mt-2 max-h-40 overflow-auto">{preview.newMembers.map((member)=><li key={member.slotId}>{member.agentName} · stable source slot <code>{member.slotId}</code></li>)}</ul><details className="mt-2"><summary className="cursor-pointer">Review exact edge topology</summary><ul className="mt-2 max-h-40 overflow-auto">{preview.edges.map((edge,index)=><li key={`${edge.sourceKind}:${edge.sourceId??''}>${edge.targetKind}:${edge.targetId??''}:${index}`}><code>{edge.sourceKind}{edge.sourceId?`:${edge.sourceId}`:''} → {edge.targetKind}{edge.targetId?`:${edge.targetId}`:''}</code></li>)}</ul></details></div>}
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>cancel</Button>{preview ? <Button variant="primary" onClick={spawn} disabled={busy}>{busy ? 'spawning…' : `commit ${preview.mode}`}</Button> : <Button variant="primary" onClick={review} disabled={busy || team.slotCount === 0}>{busy ? 'reviewing…' : 'review exact result'}</Button>}</div>
      </div>
    </div>
  )
}
