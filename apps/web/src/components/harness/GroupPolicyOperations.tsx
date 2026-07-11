import type { HarnessTemplateDetail, HarnessTemplateWithCount, LiveHarnessEdgeInput, ResolvedGroupHarness } from '@bazilion/api-types'
import { GitCompareArrows, RefreshCw, Save } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '../Button'

interface HarnessDiff {
  groupId: string
  liveRevision: number
  baseline: { instantiationId: string; templateId: string; templateRevision: number } | null
  currentSource: HarnessTemplateDetail | null
  sourceDiverged: boolean
  comparison: {
    addedSinceBaseline: unknown[]
    removedSinceBaseline: unknown[]
    currentSourceAddedSlotIds: string[]
    currentSourceRemovedSlotIds: string[]
  }
}

export function GroupPolicyOperations({ groupId, detail, templates }: { groupId: string; detail: ResolvedGroupHarness; templates: HarnessTemplateWithCount[] }) {
  const [diff, setDiff] = useState<HarnessDiff | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [templateId, setTemplateId] = useState(`${groupId}-snapshot`)
  const [templateName, setTemplateName] = useState(`${groupId} snapshot`)
  const boundAgents = useMemo(() => new Set(detail.bindings.map((item) => item.agentId)), [detail.bindings])
  const liveOnly = detail.members.filter((agent) => !boundAgents.has(agent.id))

  const reloadDiff = async () => {
    const response = await fetch(`/api/groups/${encodeURIComponent(groupId)}/harness/diff`)
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? 'Could not load source comparison')
    setDiff(await response.json())
  }
  useEffect(() => { void reloadDiff().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))) }, [groupId])

  const updateSource = async () => {
    if (!diff?.currentSource || diff.sourceDiverged) return
    setBusy(true); setError(null)
    try {
      const response = await fetch(`/api/groups/${encodeURIComponent(groupId)}/harness/update-source`, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ groupExpectedRevision: detail.harness.revision, templateExpectedRevision: diff.currentSource.template.currentRevision, includeAgentIds: liveOnly.map((agent) => agent.id) }) })
      if (!response.ok) throw new Error((await response.json().catch(()=>null))?.error ?? `Update failed (${response.status})`)
      window.location.reload()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  const saveAsTemplate = async () => {
    setBusy(true); setError(null)
    try {
      const response = await fetch(`/api/groups/${encodeURIComponent(groupId)}/harness/save-as-template`, { method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:detail.harness.revision,id:templateId,name:templateName}) })
      if (!response.ok) throw new Error((await response.json().catch(()=>null))?.error ?? `Save failed (${response.status})`)
      const saved = (await response.json()) as HarnessTemplateDetail
      window.location.assign(`/templates/teams/${encodeURIComponent(saved.template.id)}`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  return <section className="card space-y-4" aria-labelledby="source-workflows"><div className="flex flex-wrap items-start gap-3"><GitCompareArrows className="mt-1 h-5 w-5 text-sapphire"/><div className="mr-auto"><h2 id="source-workflows" className="m-0 text-lg">Baseline and source</h2><p className="muted mt-1 text-sm">Lineage is retained for comparison; source edits never auto-propagate.</p></div><Button variant="ghost" onClick={()=>void reloadDiff()}><RefreshCw className="h-4 w-4"/>Refresh comparison</Button></div>
    {!diff ? <p className="muted">Loading comparison…</p> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Baseline" value={diff.baseline ? `${diff.baseline.templateId} r${diff.baseline.templateRevision}` : 'None'} /><Metric label="Live changes" value={`+${diff.comparison.addedSinceBaseline.length} / −${diff.comparison.removedSinceBaseline.length} edges`} /><Metric label="Source slots" value={`+${diff.comparison.currentSourceAddedSlotIds.length} / −${diff.comparison.currentSourceRemovedSlotIds.length}`} /><Metric label="Source state" value={!diff.currentSource ? 'Missing/tombstoned' : diff.sourceDiverged ? 'Diverged — rebaseline required' : 'Aligned'} warning={diff.sourceDiverged || !diff.currentSource} /></div>}
    {diff?.sourceDiverged && <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">The source has changed since this Group retained its baseline. Both versions remain intact. Update-source is disabled; compare and explicitly rebaseline instead.</div>}
    {diff?.currentSource && !diff.sourceDiverged && <div className="flex flex-wrap items-center gap-3"><p className="mr-auto text-sm">Promote the current live policy to <strong>{diff.currentSource.template.name}</strong>, including {liveOnly.length} live-only Agent{liveOnly.length===1?'':'s'}.</p><Button variant="ghost" disabled={busy} onClick={updateSource}>Update source after review</Button></div>}
    <div className="grid gap-3 border-t border-frost pt-4 sm:grid-cols-[1fr_1fr_auto]"><label className="text-xs">New template ID<input value={templateId} onChange={(e)=>setTemplateId(e.target.value)} /></label><label className="text-xs">New template name<input value={templateName} onChange={(e)=>setTemplateName(e.target.value)} /></label><Button variant="primary" disabled={busy || !templateId.trim() || !templateName.trim()} onClick={saveAsTemplate}><Save className="h-4 w-4"/>Save independent Team template</Button></div>
    {error && <p role="alert" className="err">{error}</p>}
    <AdoptionWorkflow groupId={groupId} detail={detail} templates={templates} />
  </section>
}

function Metric({label,value,warning=false}:{label:string;value:string;warning?:boolean}) { return <div className={`rounded-md border p-3 ${warning?'border-amber-300 bg-amber-50 dark:bg-amber-950/30':'border-frost bg-ivory'}`}><dt className="text-xs font-semibold uppercase text-mocha-light">{label}</dt><dd className="mt-1 break-words text-sm font-semibold">{value}</dd></div> }

function AdoptionWorkflow({ groupId, detail, templates }: { groupId: string; detail: ResolvedGroupHarness; templates: HarnessTemplateWithCount[] }) {
  const [templateId, setTemplateId] = useState(templates.find((item) => !item.deletedAt)?.id ?? '')
  const [template, setTemplate] = useState<HarnessTemplateDetail | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [placements, setPlacements] = useState<Record<string, 'isolated'|'open'|'profile_defaults'>>({})
  const [preview, setPreview] = useState<LiveHarnessEdgeInput[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadTemplate = async () => {
    setError(null); setPreview(null)
    const response = await fetch(`/api/harness-templates/${encodeURIComponent(templateId)}`)
    if (!response.ok) { setError(`Could not load Team (${response.status})`); return }
    const loaded = (await response.json()) as HarnessTemplateDetail
    setTemplate(loaded)
    const next: Record<string,string> = {}
    loaded.slots.forEach((slot,index)=>{ const agent=detail.members[index]; if(agent) next[slot.slotId]=agent.id })
    setMapping(next)
    const mapped = new Set(Object.values(next))
    setPlacements(Object.fromEntries(detail.members.filter((agent)=>!mapped.has(agent.id)).map((agent)=>[agent.id,'isolated'])))
  }
  const request = () => ({ groupExpectedRevision:detail.harness.revision,templateId:template?.template.id,templateExpectedRevision:template?.template.currentRevision,slotMappings:template?.slots.map((slot)=>({slotId:slot.slotId,agentId:mapping[slot.slotId]}))??[],remainingPlacements:detail.members.filter((agent)=>!Object.values(mapping).includes(agent.id)).map((agent)=>({agentId:agent.id,placement:placements[agent.id]??'isolated'})) })
  const review = async () => {
    if (!template || template.slots.some((slot)=>!mapping[slot.slotId]) || new Set(Object.values(mapping)).size !== template.slots.length) { setError('Map every stable slot to a distinct current Agent.'); return }
    const response = await fetch(`/api/groups/${encodeURIComponent(groupId)}/harness/adopt-template/preview`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request())})
    const body=await response.json().catch(()=>null); if(!response.ok){setError(body?.error??`Preview failed (${response.status})`);return} setPreview(body.edges)
  }
  const adopt = async () => {
    if (!preview) return
    const response=await fetch(`/api/groups/${encodeURIComponent(groupId)}/harness/adopt-template`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...request(),previewEdges:preview})})
    const body=await response.json().catch(()=>null); if(!response.ok){setError(body?.error??`Rebaseline failed (${response.status})`);return} window.location.reload()
  }
  return <div className="space-y-4 border-t border-frost pt-5"><div><h3 className="m-0 text-base">Adopt or rebaseline from Team</h3><p className="muted mt-1 text-sm">Map every stable source slot to one current Agent, choose placement for remaining Agents, then review the daemon-resolved edge set.</p></div><div className="flex flex-wrap items-end gap-3"><label className="min-w-52 flex-1 text-xs">Team template<select value={templateId} onChange={(e)=>{setTemplateId(e.target.value);setTemplate(null);setPreview(null)}}>{templates.filter((item)=>!item.deletedAt).map((item)=><option key={item.id} value={item.id}>{item.name} · r{item.currentRevision}</option>)}</select></label><Button variant="ghost" onClick={loadTemplate}>Configure mapping</Button></div>
    {template && <div className="grid gap-3 md:grid-cols-2"><div className="space-y-2"><p className="text-xs font-semibold uppercase text-mocha-light">Stable slots</p>{template.slots.map((slot)=><label key={slot.slotId} className="block text-xs"><span className="block truncate" title={slot.slotId}>{slot.agentName} · slot <code>{slot.slotId.slice(0,8)}</code></span><select value={mapping[slot.slotId]??''} onChange={(e)=>{setMapping((current)=>({...current,[slot.slotId]:e.target.value}));setPreview(null)}}><option value="">Select Agent…</option>{detail.members.map((agent)=><option key={agent.id} value={agent.id} disabled={Object.entries(mapping).some(([key,value])=>key!==slot.slotId&&value===agent.id)}>{agent.name}{agent.status==='archived'?' (archived)':''}</option>)}</select></label>)}</div><div className="space-y-2"><p className="text-xs font-semibold uppercase text-mocha-light">Remaining live Agents</p>{detail.members.filter((agent)=>!Object.values(mapping).includes(agent.id)).map((agent)=><label key={agent.id} className="block text-xs">{agent.name}<select value={placements[agent.id]??'isolated'} onChange={(e)=>{setPlacements((current)=>({...current,[agent.id]:e.target.value as 'isolated'|'open'|'profile_defaults'}));setPreview(null)}}><option value="isolated">Isolated</option><option value="open">Open</option><option value="profile_defaults">Agent-template defaults</option></select></label>)}</div></div>}
    {template && <Button variant="ghost" onClick={review}>Review exact resulting policy</Button>}
    {preview && <div className="rounded-md border border-sapphire-light bg-sapphire-glow p-3 text-sm"><p>The daemon resolved <strong>{preview.length}</strong> directed allow edges. This preview is submitted unchanged and recomputed transactionally at commit.</p><div className="mt-2 max-h-40 overflow-auto"><ul>{preview.map((edge,index)=><li key={`${edge.sourceKind}:${edge.sourceId??''}>${edge.targetKind}:${edge.targetId??''}:${index}`}><code>{edge.sourceKind}{edge.sourceId?`:${edge.sourceId}`:''} → {edge.targetKind}{edge.targetId?`:${edge.targetId}`:''}</code></li>)}</ul></div><Button variant="primary" className="mt-3" onClick={adopt}>Commit reviewed rebaseline</Button></div>}
    {error && <p role="alert" className="err">{error}</p>}
  </div>
}
