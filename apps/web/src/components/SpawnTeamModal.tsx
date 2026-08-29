import type { Team, TeamTemplateWithCount, ResolvedTeamPolicy } from '@bazilion/api-types'
import { useState } from 'react'
import { Button } from './Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'

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

  async function requestBody() {
    const target = teamId.trim()
    if (!target) throw new Error('Target Team slug is required')
    const existing = teams.find((team) => team.id === target)
    let teamExpectedRevision: number | undefined
    if (existing) {
      const policyResponse = await fetch(`/api/teams/${encodeURIComponent(target)}/policy`)
      if (!policyResponse.ok) throw new Error('The target Team policy is unavailable.')
      teamExpectedRevision = ((await policyResponse.json()) as ResolvedTeamPolicy).teamPolicy.revision
    }
    return {
      target,
      body: {
        templateExpectedRevision: team.currentRevision,
        teamId: target,
        ...(teamExpectedRevision ? { teamExpectedRevision } : {}),
        mode: existing ? ('append' as const) : ('initialize' as const),
        ...(userMd ? { userMd } : {}),
      },
    }
  }

  async function review() {
    setBusy(true)
    setError(null)
    setPreview(null)
    try {
      const { body } = await requestBody()
      const response = await fetch(
        `/api/team-templates/${encodeURIComponent(team.id)}/spawn/preview`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      if (!response.ok) {
        throw new Error(
          ((await response.json().catch(() => null)) as { error?: string } | null)?.error ??
            response.statusText,
        )
      }
      setPreview(await response.json())
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function spawn() {
    const target = teamId.trim()
    if (!target) {
      setError('Target Team slug is required')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { body } = await requestBody()
      const response = await fetch(`/api/team-templates/${encodeURIComponent(team.id)}/spawn`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        throw new Error(
          ((await response.json().catch(() => null)) as { error?: string } | null)?.error ??
            response.statusText,
        )
      }
      onSpawned(target)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
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
        <DialogHeader>
          <DialogTitle className="font-serif text-xl text-foreground">
            Spawn team — {team.name}
          </DialogTitle>
          <DialogDescription>
            Uses immutable Team revision {team.currentRevision}. Existing Teams append at their
            current reviewed revision; a new Team initializes at revision 1. Conflicts never
            overwrite newer state.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <div role="alert" className="err">
            {error}
          </div>
        )}
        <label>
          Target Team slug
          <input
            value={teamId}
            onChange={(event) => {
              setTeamId(event.target.value)
              setPreview(null)
            }}
            list="canonical-teams"
            required
          />
          <datalist id="canonical-teams">
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </datalist>
        </label>
        <label>
          Starter USER.md (new Team only)
          <textarea
            rows={3}
            value={userMd}
            onChange={(event) => {
              setUserMd(event.target.value)
              setPreview(null)
            }}
            className="font-mono text-[0.88em] leading-[1.55]"
          />
        </label>
        {preview && (
          <div
            role="status"
            className="mt-4 rounded-md border border-sapphire-light bg-sapphire-glow p-3 text-sm"
          >
            <p>
              <strong>{preview.mode === 'initialize' ? 'Initialize' : 'Append'}</strong> produces
              Team revision {preview.resultingRevision}, adds {preview.newMembers.length} Agents,
              and results in {preview.edges.length} directed allow edges.
            </p>
            <ul className="mt-2 max-h-40 overflow-auto">
              {preview.newMembers.map((member) => (
                <li key={member.slotId}>
                  {member.agentName} · stable source slot <code>{member.slotId}</code>
                </li>
              ))}
            </ul>
            <details className="mt-2">
              <summary className="cursor-pointer">Review exact edge topology</summary>
              <ul className="mt-2 max-h-40 overflow-auto">
                {preview.edges.map((edge, index) => (
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
            </details>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          {preview ? (
            <Button variant="primary" onClick={spawn} disabled={busy}>
              {busy ? 'Spawning…' : `Commit ${preview.mode}`}
            </Button>
          ) : (
            <Button variant="primary" onClick={review} disabled={busy || team.slotCount === 0}>
              {busy ? 'Reviewing…' : 'Review exact result'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
