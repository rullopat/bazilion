import type { Agent, Team } from '@bazilion/api-types'
import { useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { Button } from '../Button'
import { Dialog, DialogActions } from '../Dialog'
import { SelectField } from '../ui/form'
import { Notice } from '../ui/parts'

/** Move an Agent to another Team: it joins with no connections. */
export function MoveAgentDialog({
  agent,
  teams,
  onClose,
  onMoved,
}: {
  agent: Agent
  teams: Team[]
  onClose: () => void
  onMoved: () => Promise<void>
}) {
  const others = teams.filter((team) => team.id !== agent.teamId)
  const [teamId, setTeamId] = useState(others[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const from = teams.find((team) => team.id === agent.teamId)?.name ?? agent.teamId

  async function move(event: React.FormEvent) {
    event.preventDefault()
    if (!teamId || busy) return
    setBusy(true)
    setError(null)
    try {
      await api(`/api/agents/${encodeURIComponent(agent.id)}/team`, {
        method: 'PATCH',
        body: { teamId },
      })
      await onMoved()
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={`Move ${agent.name}`}
      description={`From ${from} to another Team. Its conversations and files go with it; its connections stay behind, so it joins the other Team with none.`}
      busy={busy}
      onClose={onClose}
    >
      <form onSubmit={(event) => void move(event)} className="grid gap-4">
        <SelectField
          label="Team"
          value={teamId}
          options={others.map((team) => ({ value: team.id, label: team.name }))}
          disabled={busy}
          className="max-w-none"
          onChange={setTeamId}
        />
        {error && (
          <Notice tone="warning" role="alert" title="It was not moved.">
            {error}
          </Notice>
        )}
        <DialogActions>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy || !teamId}>
            {busy
              ? 'Moving…'
              : `Move to ${teams.find((team) => team.id === teamId)?.name ?? 'Team'}`}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
