import type { Agent, Group, ResolvedGroupHarness } from '@bazilion/api-types'
import { Download, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '../Button'
import { liveEdges } from '../../lib/canonical-harness'
import type { HarnessDocument } from '../../lib/harness-prototype'

export function LocalHarnessMigration({ harness, groups, agents }: { harness: HarnessDocument; groups: Group[]; agents: Agent[] }) {
  const [templateId, setTemplateId] = useState(`${harness.id.replace(/^template-/, '')}-import`)
  const [templateName, setTemplateName] = useState(`${harness.name} imported`)
  const [groupId, setGroupId] = useState(harness.boundGroupId ?? groups[0]?.id ?? '')
  const [comparison, setComparison] = useState<ResolvedGroupHarness | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const groupAgentIds = useMemo(() => new Set(agents.filter((agent) => agent.groupId === groupId).map((agent) => agent.id)), [agents, groupId])
  const draftAgentIds = harness.members.flatMap((member) => member.agentId ? [member.agentId] : [])
  const mappingValid = harness.kind === 'live' && draftAgentIds.length === harness.members.length && draftAgentIds.every((id) => groupAgentIds.has(id))

  const exportReviewed = () => {
    const payload = JSON.stringify({ format: 'bazilion-harness-prototype-export', version: 1, exportedAt: Date.now(), harness }, null, 2)
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = `${harness.id}.json`; link.click(); URL.revokeObjectURL(url)
  }

  const importTemplate = async () => {
    setBusy(true); setNotice(null)
    try {
      const imported = await fetch('/api/harness-templates/import', { method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:templateId,name:templateName,slots:harness.members.map((member)=>({clientKey:member.slotId,profileId:member.profileId,agentName:member.name,layoutPosition:member.position})),edges:harness.policy.edges.map((edge)=>{ const source = importEndpoint(harness, edge.source); const target = importEndpoint(harness, edge.target); return { sourceKind: source.kind, sourceId: source.id, targetKind: target.kind, targetId: target.id } })}) })
      if (!imported.ok) throw new Error((await imported.json().catch(()=>null))?.error ?? `Import failed (${imported.status})`)
      window.location.assign(`/templates/teams/${encodeURIComponent(templateId)}`)
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  const compareGroup = async () => {
    setNotice(null)
    const response = await fetch(`/api/groups/${encodeURIComponent(groupId)}/harness`)
    if (!response.ok) { setNotice(`Could not load Group (${response.status})`); return }
    setComparison(await response.json())
  }
  const applyGroup = async () => {
    if (!comparison || !mappingValid) return
    setBusy(true); setNotice(null)
    try {
      const response = await fetch(`/api/groups/${encodeURIComponent(groupId)}/harness/policy`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:comparison.harness.revision,edges:liveEdges(harness)})})
      if (!response.ok) throw new Error((await response.json().catch(()=>null))?.error ?? `Apply failed (${response.status})`)
      window.location.assign(`/groups/${encodeURIComponent(groupId)}/policy`)
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  return <section className="card space-y-5" aria-labelledby="migration-title"><div><h2 id="migration-title" className="m-0 text-lg">Reviewed migration</h2><p className="muted mt-1 text-sm">Nothing uploads or deletes automatically. Simulated local blocks are excluded and never become production evidence.</p></div>
    <Button variant="ghost" onClick={exportReviewed}><Download className="h-4 w-4"/>Export this local document</Button>
    <div className="grid gap-3 border-t border-frost pt-4 sm:grid-cols-[1fr_1fr_auto]"><label className="text-xs">New Team template ID<input value={templateId} onChange={(e)=>setTemplateId(e.target.value)}/></label><label className="text-xs">Name<input value={templateName} onChange={(e)=>setTemplateName(e.target.value)}/></label><Button variant="primary" disabled={busy || !templateId || !templateName} onClick={importTemplate}><Upload className="h-4 w-4"/>Import as new Team</Button></div>
    {harness.kind === 'live' && <div className="space-y-3 border-t border-frost pt-4"><div className="flex flex-wrap items-end gap-3"><label className="min-w-48 flex-1 text-xs">Compare with canonical Group<select value={groupId} onChange={(e)=>{setGroupId(e.target.value);setComparison(null)}}>{groups.map((group)=><option key={group.id} value={group.id}>{group.name}</option>)}</select></label><Button variant="ghost" onClick={compareGroup}>Compare current revision</Button></div>{comparison && <div className="rounded-md border border-frost bg-ivory p-3 text-sm"><p>Local draft: <strong>{harness.policy.edges.length}</strong> edges. Effective Group revision {comparison.harness.revision}: <strong>{comparison.edges.length}</strong> edges.</p><p className="mt-1">Agent identity mapping: <strong>{mappingValid ? 'valid' : 'invalid — every local member must reference a current Group Agent'}</strong>.</p><Button variant="primary" className="mt-3" disabled={!mappingValid || busy} onClick={applyGroup}>Apply reviewed draft to Group</Button></div>}</div>}
    {notice && <p role="alert" className="err">{notice}</p>}
  </section>
}

function importEndpoint(harness: HarnessDocument, endpoint: HarnessDocument['policy']['edges'][number]['source']) {
  if (endpoint.kind === 'member_slot') return { kind: 'slot', id: endpoint.slotId }
  if (endpoint.kind === 'agent') {
    return { kind: 'slot', id: harness.members.find((member) => member.agentId === endpoint.agentId)?.slotId ?? null }
  }
  return { kind: endpoint.kind, id: null }
}
