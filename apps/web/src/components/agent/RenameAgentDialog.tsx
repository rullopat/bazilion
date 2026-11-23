import { AGENT_NAME_MAX, type Agent } from '@bazilion/api-types'
import { useState } from 'react'
import { renameAgent } from '../../lib/agent-actions'
import { errorMessage } from '../../lib/api'
import { Button } from '../Button'
import { Dialog, DialogActions } from '../Dialog'

/** A new display name for an Agent, from its row in the rail or from its panel. */
export function RenameAgentDialog({
  agent,
  onClose,
  onRenamed,
}: {
  agent: Agent
  onClose: () => void
  onRenamed: () => Promise<void>
}) {
  const [name, setName] = useState(agent.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const unchanged = !name.trim() || name.trim() === agent.name

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (unchanged) return
    setBusy(true)
    setError(null)
    try {
      await renameAgent(agent.id, name.trim())
      await onRenamed()
      onClose()
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={`Rename ${agent.name}`}
      description="This changes the display name only; the Agent ID and history stay the same."
      busy={busy}
      onClose={onClose}
      className="max-w-md"
    >
      <form onSubmit={(event) => void submit(event)}>
        <label>
          Agent name
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={AGENT_NAME_MAX}
          />
        </label>
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="mt-4">
          <DialogActions>
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={busy || unchanged}>
              {busy ? 'Renaming…' : 'Rename agent'}
            </Button>
          </DialogActions>
        </div>
      </form>
    </Dialog>
  )
}
