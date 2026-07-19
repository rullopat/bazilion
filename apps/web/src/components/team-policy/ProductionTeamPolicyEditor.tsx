import type {
  CommunicationAuthorizationResult,
  TeamTemplateDetail,
  Profile,
  ResolvedTeamPolicy,
} from '@bazilion/api-types'
import { AlertTriangle, ListTree, Plus, Save, TableProperties, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '../Button'
import {
  addTeamPolicyEdge,
  applyProfileDefaults,
  createPresetPolicy,
  endpointForMember,
  endpointFromKey,
  endpointKey,
  hasTeamPolicyEdge,
  isValidTeamPolicyConnection,
  removeTeamPolicyEdge,
  type TeamPolicyDocument,
  type TeamPolicyEndpoint,
} from '../../lib/team-policy'
import {
  liveDocument,
  liveEdges,
  sameDocument,
  templateDefinition,
  templateDocument,
} from '../../lib/canonical-team'
import { teamPolicyEndpointLabel } from '../../lib/team-policy-presenter'
import { TeamPolicyFlow } from './TeamPolicyFlow'
import { TeamPolicyMatrix } from './TeamPolicyMatrix'

type Source =
  | { kind: 'template'; detail: TeamTemplateDetail }
  | { kind: 'live'; teamId: string; detail: ResolvedTeamPolicy }

export function ProductionTeamPolicyEditor({ source, profiles, initialUi }: { source: Source; profiles: Profile[]; initialUi?: { view?: 'flow'|'matrix'; selectedId?: string|null; viewport?: {x:number;y:number;zoom:number} } }) {
  const initial = useMemo(
    () => source.kind === 'template' ? templateDocument(source.detail) : liveDocument(source.teamId, source.detail),
    [source],
  )
  const [server, setServer] = useState(initial)
  const [draft, setDraft] = useState(initial)
  const [revision, setRevision] = useState(
    source.kind === 'template' ? source.detail.template.currentRevision : source.detail.teamPolicy.revision,
  )
  const [view, setView] = useState<'flow' | 'matrix'>(initialUi?.view ?? 'flow')
  const [selectedId, setSelectedId] = useState<string | null>(() => validSelection(initial, initialUi?.selectedId))
  const [viewport, setViewport] = useState(initialUi?.viewport ?? { x: 0, y: 0, zoom: 0.9 })
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [conflict, setConflict] = useState<TeamPolicyDocument | null>(null)
  const dirty = !sameDocument(server, draft)

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const mutateEdge = (from: TeamPolicyEndpoint, to: TeamPolicyEndpoint, allowed: boolean) => {
    if (!isValidTeamPolicyConnection(from, to)) return
    setDraft((current) => ({
      ...current,
      policy: allowed ? addTeamPolicyEdge(current.policy, from, to) : removeTeamPolicyEdge(current.policy, from, to),
    }))
  }

  const setEdgePosture = (
    from: TeamPolicyEndpoint,
    to: TeamPolicyEndpoint,
    posture: 'allow' | 'approval_required',
  ) =>
    setDraft((current) => ({
      ...current,
      policy: {
        ...current.policy,
        edges: current.policy.edges.map((item) =>
          endpointKey(item.source) === endpointKey(from) &&
          endpointKey(item.target) === endpointKey(to)
            ? { ...item, posture }
            : item,
        ),
      },
    }))

  const reloadCurrent = async (): Promise<{ document: TeamPolicyDocument; revision: number }> => {
    const url = source.kind === 'template'
      ? `/api/team-templates/${encodeURIComponent(source.detail.template.id)}`
      : `/api/teams/${encodeURIComponent(source.teamId)}/policy`
    const response = await fetch(url)
    if (!response.ok) throw new Error(await response.text())
    if (source.kind === 'template') {
      const detail = (await response.json()) as TeamTemplateDetail
      return { document: templateDocument(detail), revision: detail.template.currentRevision }
    }
    const detail = (await response.json()) as ResolvedTeamPolicy
    return { document: liveDocument(source.teamId, detail), revision: detail.teamPolicy.revision }
  }

  const save = async () => {
    setSaving(true)
    setNotice(null)
    try {
      const response = source.kind === 'template'
        ? await fetch(`/api/team-templates/${encodeURIComponent(source.detail.template.id)}/definition`, {
            method: 'PUT', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ expectedRevision: revision, ...templateDefinition(draft, profiles) }),
          })
        : await fetch(`/api/teams/${encodeURIComponent(source.teamId)}/policy`, {
            method: 'PUT', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ expectedRevision: revision, edges: liveEdges(draft) }),
          })
      if (response.status === 409) {
        const current = await reloadCurrent()
        setConflict(current.document)
        setServer(current.document)
        setRevision(current.revision)
        setNotice('The server changed. Your draft is preserved; compare, reload, or reapply it.')
        return
      }
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? `Save failed (${response.status})`)
      const current = await reloadCurrent()
      setServer(current.document)
      setDraft(current.document)
      setRevision(current.revision)
      setConflict(null)
      setNotice(`Effective policy saved as revision ${current.revision}.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const selected = selectedId ? endpointFromKey(selectedId) : null
  const selectedMember = selected
    ? draft.members.find((member) => endpointKey(endpointForMember(draft, member)) === selectedId)
    : undefined
  const incomplete = new Set(
    draft.members.filter((member) => !profiles.some((profile) => profile.id === member.profileId)).map((member) => member.slotId),
  )

  return (
    <section className="overflow-hidden rounded-lg border border-frost bg-snow" aria-label="Production policy editor">
      <header className="flex flex-wrap items-center gap-2 border-b border-frost bg-cream p-3">
        <div className="mr-auto min-w-0">
          <div className="flex items-center gap-2"><h2 className="m-0 truncate text-lg">{draft.name}</h2>
            <span className={dirty ? 'rounded bg-warning/10 px-2 py-0.5 text-xs text-warning' : 'rounded bg-sapphire-glow px-2 py-0.5 text-xs text-sapphire-deep'}>
              {dirty ? 'Unsaved draft' : `Effective · revision ${revision}`}
            </span>
          </div>
          <p className="muted m-0 text-xs">{source.kind === 'template' ? 'Stable Team slot policy' : 'One effective live Team policy'}</p>
        </div>
        <div className="flex rounded-md border border-frost bg-ivory p-0.5" aria-label="Policy projection">
          <Projection active={view === 'flow'} label="Flow" icon={<ListTree className="h-4 w-4" />} onClick={() => setView('flow')} />
          <Projection active={view === 'matrix'} label="Matrix" icon={<TableProperties className="h-4 w-4" />} onClick={() => setView('matrix')} />
        </div>
        <Button variant="ghost" disabled={!dirty || saving} onClick={() => setDraft(server)}>Discard</Button>
        <Button variant="primary" disabled={!dirty || saving || (source.kind === 'template' && !!source.detail.template.deletedAt)} onClick={save}><Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save effective policy'}</Button>
      </header>
      {notice && <div role="status" className="border-b border-frost bg-ivory px-4 py-2 text-sm">{notice}</div>}
      {conflict && <ConflictBanner draft={draft} server={conflict} onReload={() => { setDraft(conflict); setConflict(null) }} onReapply={() => setConflict(null)} />}
      <div className="grid min-h-[620px] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-h-[480px] overflow-hidden">
          {view === 'flow' ? <TeamPolicyFlow teamPolicy={draft} selectedId={selectedId} viewport={viewport} incompleteSlotIds={incomplete} simulatedPath={null} onSelect={setSelectedId} onConnect={(a,b) => mutateEdge(a,b,true)} onRemoveEdge={(a,b) => mutateEdge(a,b,false)} onMoveMember={(slotId, position) => setDraft((current) => ({...current, members: current.members.map((m) => m.slotId === slotId ? {...m, position} : m)}))} onViewportChange={setViewport} onOpenMember={(member) => source.kind === 'live' && member.agentId ? window.location.assign(`/agents/${encodeURIComponent(member.agentId)}?teamPolicy=${encodeURIComponent(source.teamId)}&view=${view}&selected=${encodeURIComponent(selectedId ?? '')}&vx=${viewport.x}&vy=${viewport.y}&vz=${viewport.zoom}`) : setSelectedId(endpointKey(endpointForMember(draft, member)))} /> : <TeamPolicyMatrix teamPolicy={draft} selectedId={selectedId} onSelect={setSelectedId} onToggle={mutateEdge} />}
        </div>
        <aside className="border-t border-frost p-4 lg:border-l lg:border-t-0">
          <Inspector document={draft} selected={selected} selectedMember={selectedMember} profiles={profiles} source={source} onDraft={setDraft} onToggle={mutateEdge} onPosture={setEdgePosture} />
        </aside>
      </div>
    </section>
  )
}

function validSelection(document: TeamPolicyDocument, selectedId: string | null | undefined): string | null {
  if (!selectedId) return null
  if (selectedId === 'user' || selectedId === 'outside_team') return selectedId
  if (document.policy.edges.some((edge) => edge.id === selectedId)) return selectedId
  return document.members.some((member) => endpointKey(endpointForMember(document, member)) === selectedId)
    ? selectedId
    : null
}

function Projection({ active, label, icon, onClick }: { active: boolean; label: string; icon: React.ReactNode; onClick: () => void }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${active ? 'bg-snow text-sapphire shadow-sm' : 'text-mocha'}`}>{icon}{label}</button>
}

function ConflictBanner({ draft, server, onReload, onReapply }: { draft: TeamPolicyDocument; server: TeamPolicyDocument; onReload: () => void; onReapply: () => void }) {
  return <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-warning/25 bg-warning/10 p-3 text-sm text-warning"><AlertTriangle className="h-4 w-4" /><span className="mr-auto">Conflict: server has {server.policy.edges.length} edges; your preserved draft has {draft.policy.edges.length}.</span><Button variant="ghost" onClick={onReload}>Reload server</Button><Button variant="primary" onClick={onReapply}>Keep draft and reapply</Button></div>
}

function Inspector({ document, selected, selectedMember, profiles, source, onDraft, onToggle, onPosture }: { document: TeamPolicyDocument; selected: TeamPolicyEndpoint | null; selectedMember?: TeamPolicyDocument['members'][number]; profiles: Profile[]; source: Source; onDraft: React.Dispatch<React.SetStateAction<TeamPolicyDocument>>; onToggle: (a: TeamPolicyEndpoint,b: TeamPolicyEndpoint,c:boolean) => void; onPosture: (a: TeamPolicyEndpoint,b: TeamPolicyEndpoint,p:'allow'|'approval_required')=>void }) {
  const [simSource, setSimSource] = useState('user')
  const [simTarget, setSimTarget] = useState(document.members[0] ? endpointKey(endpointForMember(document, document.members[0])) : 'outside_team')
  const [result, setResult] = useState<CommunicationAuthorizationResult | null>(null)
  const actors = [{ key: 'user', label: 'User' }, ...document.members.map((m) => ({key: endpointKey(endpointForMember(document,m)), label: m.name})), {key:'outside_team',label:'Other teams'}]
  const selectedProfile = selectedMember ? profiles.find((profile) => profile.id === selectedMember.profileId) : undefined
  const simulate = async () => {
    const from = endpointFromKey(simSource); const to = endpointFromKey(simTarget); if (!from || !to) return
    if (source.kind !== 'live') { setResult({decision: hasTeamPolicyEdge(document.policy,from,to)?'allow':'deny', channel:'user', reasonCode:'draft_preview', reason:'Draft-only preview; no audit event was created.', policyRefs:[], componentOutcomes:[], matchedEdgeIds:[], requiredEdgeIds:[]}); return }
    const endpoint = (value: TeamPolicyEndpoint) => value.kind === 'agent' ? {kind:'agent' as const,id:value.agentId} : {kind:value.kind,teamId:source.teamId}
    const response = await fetch('/api/communication/evaluate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:endpoint(from),target:endpoint(to),origin:'web',attemptKind:'diagnostic',attemptId:crypto.randomUUID()})})
    setResult(await response.json())
  }
  return <div className="space-y-5">
    <div><p className="text-xs font-semibold uppercase text-mocha-light">Inspector</p><h3 className="mt-1 text-base">{selected ? teamPolicyEndpointLabel(document, selected) : 'Policy summary'}</h3><p className="muted text-xs">{document.members.length} actors · {document.policy.edges.length} directed allow edges</p></div>
    {document.kind === 'template' && !selected && <div className="space-y-2"><p className="text-xs font-semibold">Preset preview</p><p className="muted text-xs">Applying a preset visibly replaces this draft edge set; it is never effective until saved.</p><select aria-label="Policy preset" value={document.preset} onChange={(event)=>onDraft((current)=>({...current,preset:event.target.value as TeamPolicyDocument['preset']}))}><option value="open_team">Open Team</option><option value="coordinator">Coordinator</option><option value="review_pipeline">Review Pipeline</option><option value="blank">Blank</option></select><Button variant="ghost" onClick={()=>onDraft((current)=>({...current,policy:createPresetPolicy('template',current.members,current.preset)}))}>Apply preset to draft</Button></div>}
    {selectedMember && document.kind === 'template' && <div className="space-y-2"><label className="text-xs">Agent name<input value={selectedMember.name} onChange={(e) => onDraft((d)=>({...d,members:d.members.map((m)=>m.slotId===selectedMember.slotId?{...m,name:e.target.value}:m)}))}/></label><label className="text-xs">Agent template<select value={selectedMember.profileId} onChange={(e)=>onDraft((d)=>({...d,members:d.members.map((m)=>m.slotId===selectedMember.slotId?{...m,profileId:e.target.value}:m)}))}>{profiles.map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>{selectedProfile?.communicationDefaults && <Button variant="ghost" onClick={()=>onDraft((current)=>({...current,policy:applyProfileDefaults(current.policy,current,selectedMember,selectedProfile.communicationDefaults!)}))}>Apply Agent-template defaults to draft</Button>}</div>}
    {selected && <div className="space-y-2"><p className="text-xs font-semibold">Directed permissions</p>{actors.map((actor)=>{const target=endpointFromKey(actor.key); if(!target || !isValidTeamPolicyConnection(selected,target)) return null; const allowed=hasTeamPolicyEdge(document.policy,selected,target); const current=document.policy.edges.find((item)=>endpointKey(item.source)===endpointKey(selected)&&endpointKey(item.target)===endpointKey(target)); return <div key={actor.key} className="rounded border border-frost p-2 text-xs"><button type="button" aria-pressed={allowed} onClick={()=>onToggle(selected,target,!allowed)} className="flex w-full items-center justify-between"><span>Send to {actor.label}</span>{allowed?'Allowed':'Denied'}</button>{allowed&&<button type="button" aria-pressed={current?.posture==='approval_required'} onClick={()=>onPosture(selected,target,current?.posture==='approval_required'?'allow':'approval_required')} className="mt-2 w-full rounded bg-ivory px-2 py-1 text-left">{current?.posture==='approval_required'?'Approval required':'Immediate delivery'}</button>}</div>})}</div>}
    <div className="space-y-2 border-t border-frost pt-4"><p className="text-xs font-semibold">Side-effect-free simulator</p><select aria-label="Simulation source" value={simSource} onChange={(e)=>setSimSource(e.target.value)}>{actors.map((a)=><option key={a.key} value={a.key}>{a.label}</option>)}</select><select aria-label="Simulation target" value={simTarget} onChange={(e)=>setSimTarget(e.target.value)}>{actors.map((a)=><option key={a.key} value={a.key}>{a.label}</option>)}</select><Button variant="ghost" onClick={simulate}>Evaluate without sending</Button>{result && <p role="status" className={`rounded p-2 text-xs ${result.decision==='allow'?'bg-sapphire-glow':'bg-rose-baziu/10'}`}>{result.decision.toUpperCase()} · {result.reasonCode}<br/>{result.reason}</p>}</div>
    {document.kind === 'template' && <Button variant="ghost" onClick={()=>onDraft((d)=>({...d,members:[...d.members,{slotId:`draft:${crypto.randomUUID()}`,profileId:profiles[0]?.id??'',name:`Agent ${d.members.length+1}`,position:{x:250+(d.members.length%3)*250,y:40+Math.floor(d.members.length/3)*130}}]}))}><Plus className="h-4 w-4"/>Add stable slot</Button>}
    {selectedMember && document.kind === 'template' && <Button variant="danger" onClick={()=>onDraft((d)=>({...d,members:d.members.filter((m)=>m.slotId!==selectedMember.slotId),policy:{...d.policy,edges:d.policy.edges.filter((e)=>endpointKey(e.source)!==endpointKey(selected!)&& endpointKey(e.target)!==endpointKey(selected!))}}))}><X className="h-4 w-4"/>Remove slot and incident edges</Button>}
  </div>
}
