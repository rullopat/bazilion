// Spawn an agent from a profile, with name + group fields. POSTs to
// /api/agents (proxied to daemon) and navigates to ?agent=<newId>.

import type { Agent, Group, ResolvedGroupHarness } from '@bazilion/api-types'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { DEFAULT_GROUP_ID } from '../lib/wire-constants'

interface Props {
  profileId: string
  groupHint?: string
  groups: Group[]
  onClose: () => void
}

export function SpawnDialog({ profileId, groupHint, groups, onClose }: Props) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [groupId, setGroupId] = useState(
    groupHint ??
      groups.find((group) => group.id === DEFAULT_GROUP_ID)?.id ??
      groups[0]?.id ??
      '',
  )
  const [placement, setPlacement] = useState<'isolated' | 'open' | 'profile_defaults'>('profile_defaults')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [preview, setPreview] = useState<{
    currentRevision: number
    resultingRevision: number
    symbolicAgentId: string
    existingEdges: unknown[]
    addedEdges: Array<{
      sourceKind: string
      sourceId: string | null
      targetKind: string
      targetId: string | null
    }>
  } | null>(null)

  async function requestBody() {
    const policy = await fetch(`/api/groups/${encodeURIComponent(groupId)}/harness`)
    if (!policy.ok) throw new Error('The selected Group policy is unavailable. Reload and try again.')
    const current = (await policy.json()) as ResolvedGroupHarness
    return {
      current,
      body: {
        profileId,
        groupId,
        groupExpectedRevision: current.harness.revision,
        placement,
      },
    }
  }

  async function review() {
    setErr(null)
    setBusy(true)
    try {
      const { body } = await requestBody()
      const response = await fetch('/api/agents/placement-preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const value = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(value?.error ?? `Preview failed (${response.status})`)
      }
      setPreview(await response.json())
    } catch (cause) {
      setErr((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    try {
      if (!preview) {
        await review()
        return
      }
      const body: Record<string, string | number> = {
        profile: profileId,
        groupExpectedRevision: preview.currentRevision,
        placement,
      }
      if (name.trim()) body.name = name.trim()
      if (groupId) body.groupId = groupId
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(e.error ?? `${res.status} ${res.statusText}`)
      }
      const result = (await res.json()) as { agent: Agent }
      const created = result.agent
      onClose()
      await navigate({ to: '/', search: { agent: created.id } })
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Backdrop onClose={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="spawn-agent-title"
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="spawn-agent-title" className="font-serif text-xl text-foreground mb-1">Spawn a new agent</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Profile: <code className="font-mono">{profileId}</code>
        </p>
        <label className="block text-sm text-foreground mb-3">
          Agent name{' '}
          <span className="text-muted-foreground font-normal">
            (optional — defaults to the profile's name)
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            // biome-ignore lint/a11y/noAutofocus: dialog convention
            autoFocus
            autoComplete="off"
            className="mt-1 block w-full rounded-md border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring/30"
          />
        </label>
        <label className="block text-sm text-foreground mb-3">
          Initial policy placement
          <select value={placement} onChange={(e) => {setPlacement(e.target.value as typeof placement);setPreview(null)}} className="mt-1 block w-full rounded-md border bg-background px-3 py-2">
            <option value="profile_defaults">agent-template defaults</option>
            <option value="isolated">isolated</option>
            <option value="open">open to current members and boundaries</option>
          </select>
          <span className="mt-1 block text-xs text-muted-foreground">The current Group revision is checked again when you submit.</span>
        </label>
        <label className="block text-sm text-foreground mb-3">
          Group
          <select
            value={groupId}
            onChange={(e) => {setGroupId(e.target.value);setPreview(null)}}
            className="mt-1 block w-full rounded-md border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring/30"
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
                {g.id === DEFAULT_GROUP_ID ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </label>
        {err && <p className="mt-2 text-sm text-rose-700">{err}</p>}
        {preview && <div className="mt-3 rounded-md border border-sapphire-light bg-sapphire-glow p-3 text-sm"><p>Creating this Agent advances Group revision {preview.currentRevision} → <strong>{preview.resultingRevision}</strong> and adds <strong>{preview.addedEdges.length}</strong> directed edges to the existing {preview.existingEdges.length}.</p><ul className="mt-2 max-h-36 overflow-auto">{preview.addedEdges.map((edge,index)=><li key={`${edge.sourceKind}:${edge.sourceId??''}>${edge.targetKind}:${edge.targetId??''}:${index}`}><code>{edge.sourceKind}{edge.sourceId?`:${edge.sourceId}`:''} → {edge.targetKind}{edge.targetId?`:${edge.targetId}`:''}</code></li>)}</ul>{preview.addedEdges.length===0&&<p className="mt-2">The new Agent starts isolated.</p>}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-3 py-2 text-sm text-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? 'Working…' : preview ? 'Commit reviewed creation' : 'Review exact policy'}
          </button>
        </div>
      </form>
    </Backdrop>
  )
}

function Backdrop({
  children,
  onClose,
}: {
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: ESC is handled by browsers via dialog convention; backdrop click is purely augmentative.
    // biome-ignore lint/a11y/noStaticElementInteractions: ditto
    <div
      onClick={onClose}
      onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px]"
    >
      {children}
    </div>
  )
}
