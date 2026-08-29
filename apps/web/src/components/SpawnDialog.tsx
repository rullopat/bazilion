// Spawn an agent from a profile, with name + team fields. POSTs to
// /api/agents (proxied to daemon) and navigates to ?agent=<newId>.

import type { Agent, Team, ResolvedTeamPolicy } from '@bazilion/api-types'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { DEFAULT_TEAM_ID } from '../lib/wire-constants'
import { Button } from './Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'

interface Props {
  profileId: string
  teamHint?: string
  teams: Team[]
  onClose: () => void
}

export function SpawnDialog({ profileId, teamHint, teams, onClose }: Props) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [teamId, setTeamId] = useState(
    teamHint ??
      teams.find((team) => team.id === DEFAULT_TEAM_ID)?.id ??
      teams[0]?.id ??
      '',
  )
  const [placement, setPlacement] = useState<'isolated' | 'profile_defaults'>('profile_defaults')
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
    const policy = await fetch(`/api/teams/${encodeURIComponent(teamId)}/policy`)
    if (!policy.ok) throw new Error('The selected Team policy is unavailable. Reload and try again.')
    const current = (await policy.json()) as ResolvedTeamPolicy
    return {
      current,
      body: {
        profileId,
        teamId,
        teamExpectedRevision: current.teamPolicy.revision,
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
        teamExpectedRevision: preview.currentRevision,
        placement,
      }
      if (name.trim()) body.name = name.trim()
      if (teamId) body.teamId = teamId
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent
        showCloseButton={!busy}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-3xl border border-frost bg-card p-6 shadow-baziu-lg sm:p-7"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault()
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault()
        }}
      >
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="font-serif text-xl text-foreground">
              Spawn a new agent
            </DialogTitle>
            <DialogDescription>
              Create an agent from profile <code className="font-mono">{profileId}</code>, then
              review its exact Team policy placement before committing.
            </DialogDescription>
          </DialogHeader>
          <label className="mb-3 mt-4 block text-sm text-foreground">
            Agent name{' '}
            <span className="text-muted-foreground font-normal">
              (optional — defaults to the profile's name)
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              className="mt-1 block w-full rounded-md border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring/30"
            />
          </label>
          <label className="mb-3 block text-sm text-foreground">
            Initial policy placement
            <select
              value={placement}
              onChange={(e) => {
                setPlacement(e.target.value as typeof placement)
                setPreview(null)
              }}
              className="mt-1 block w-full rounded-md border bg-background px-3 py-2"
            >
              <option value="profile_defaults">Agent-template defaults</option>
              <option value="isolated">Isolated</option>
            </select>
            <span className="mt-1 block text-xs text-muted-foreground">
              The current Team revision is checked again when you submit.
            </span>
          </label>
          <label className="mb-3 block text-sm text-foreground">
            Team
            <select
              value={teamId}
              onChange={(e) => {
                setTeamId(e.target.value)
                setPreview(null)
              }}
              className="mt-1 block w-full rounded-md border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring/30"
            >
              {teams.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                  {g.id === DEFAULT_TEAM_ID ? ' (default)' : ''}
                </option>
              ))}
            </select>
          </label>
          {err && (
            <p role="alert" className="err mt-2">
              {err}
            </p>
          )}
          {preview && (
            <div
              role="status"
              className="mt-3 rounded-md border border-sapphire-light bg-sapphire-glow p-3 text-sm"
            >
              <p>
                Creating this Agent advances Team revision {preview.currentRevision} →{' '}
                <strong>{preview.resultingRevision}</strong> and adds{' '}
                <strong>{preview.addedEdges.length}</strong> directed edges to the existing{' '}
                {preview.existingEdges.length}.
              </p>
              <ul className="mt-2 max-h-36 overflow-auto">
                {preview.addedEdges.map((edge, index) => (
                  <li
                    key={`${edge.sourceKind}:${edge.sourceId ?? ''}>${edge.targetKind}:${edge.targetId ?? ''}:${index}`}
                  >
                    <code>
                      {edge.sourceKind}
                      {edge.sourceId ? `:${edge.sourceId}` : ''} → {edge.targetKind}
                      {edge.targetId ? `:${edge.targetId}` : ''}
                    </code>
                  </li>
                ))}
              </ul>
              {preview.addedEdges.length === 0 && (
                <p className="mt-2">The new Agent starts isolated.</p>
              )}
            </div>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? 'Working…' : preview ? 'Commit reviewed creation' : 'Review exact policy'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
