import type { Team, TeamTemplate } from '@bazilion/api-types'
import { useState } from 'react'
import { api, errorMessage } from '../lib/api'
import { Button } from './Button'
import { Dialog, DialogActions } from './Dialog'

/** Spawn a Team template's Agents and allow edges into a new or existing Team. */
export function SpawnTeamModal({
  template,
  teams,
  initialTeamId = '',
  onClose,
  onSpawned,
}: {
  template: TeamTemplate
  teams: Team[]
  /** Pre-fills the target slug, as the Team page does for itself. */
  initialTeamId?: string
  onClose: () => void
  onSpawned: (teamSlug: string) => void
}) {
  const [teamId, setTeamId] = useState(initialTeamId)
  const [userMd, setUserMd] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const target = teamId.trim()
  const existing = teams.some((team) => team.id === target)

  async function spawn(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api(`/api/team-templates/${encodeURIComponent(template.id)}/spawn`, {
        body: { teamId: target, ...(userMd && !existing ? { userMd } : {}) },
      })
      onSpawned(target)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={`Spawn team: ${template.name}`}
      description={
        <>
          Creates {template.slots.length} Agent{template.slots.length === 1 ? '' : 's'} and{' '}
          {template.edges.length} allow edge{template.edges.length === 1 ? '' : 's'}. An unknown
          slug creates a new {template.policyMode} Team; an existing Team keeps its mode.
        </>
      }
      busy={busy}
      onClose={onClose}
    >
      <form onSubmit={(event) => void spawn(event)}>
        <label>
          Target Team slug
          <input
            value={teamId}
            onChange={(event) => setTeamId(event.target.value)}
            list="spawn-team-targets"
            required
          />
          <datalist id="spawn-team-targets">
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </datalist>
        </label>
        {!existing && (
          <label>
            Starter USER.md (new Team only; defaults to the template's)
            <textarea
              rows={3}
              value={userMd}
              onChange={(event) => setUserMd(event.target.value)}
              className="font-mono text-[0.88em] leading-[1.55]"
            />
          </label>
        )}
        {error && (
          <p role="alert" className="err mt-2">
            {error}
          </p>
        )}
        <div className="mt-4">
          <DialogActions>
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={busy || !target || template.slots.length === 0}
            >
              {busy ? 'Spawning…' : 'Spawn team'}
            </Button>
          </DialogActions>
        </div>
      </form>
    </Dialog>
  )
}
