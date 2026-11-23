import type { Team, TeamTemplate } from '@bazilion/api-types'
import { useState } from 'react'
import { api, errorMessage } from '../lib/api'
import { count, slugify, slugProblem } from '../lib/manage'
import { MODE_SENTENCE } from '../lib/team-policy'
import { Button } from './Button'
import { Dialog, DialogActions } from './Dialog'
import { ChoiceCards, SelectField, TextField } from './ui/form'
import { Notice } from './ui/parts'

type Target = 'new' | 'existing'

/** Use a Team template: add its Agents and connections to a new Team or one that exists. */
export function SpawnTeamModal({
  template,
  teams,
  initialTeamId = '',
  onClose,
  onSpawned,
}: {
  template: TeamTemplate
  teams: Team[]
  /** Offers this Team first, as the Team tab does for its own Team. */
  initialTeamId?: string
  onClose: () => void
  onSpawned: (teamSlug: string) => void
}) {
  const known = teams.some((team) => team.id === initialTeamId)
  const [target, setTarget] = useState<Target>(known ? 'existing' : 'new')
  const [existing, setExisting] = useState(known ? initialTeamId : (teams[0]?.id ?? ''))
  const [newId, setNewId] = useState(known ? '' : initialTeamId || slugify(template.name))
  const [userMd, setUserMd] = useState(template.userMd ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const teamId = target === 'existing' ? existing : newId.trim()
  const idProblem =
    target === 'new'
      ? (slugProblem(teamId) ??
        (teams.some((team) => team.id === teamId)
          ? 'A Team with this ID exists: choose it under “A Team that exists”.'
          : undefined))
      : undefined
  const ready = teamId !== '' && !idProblem && template.slots.length > 0

  async function spawn(event: React.FormEvent) {
    event.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      await api(`/api/team-templates/${encodeURIComponent(template.id)}/spawn`, {
        // Left out when unchanged, so the daemon starts from the template's own.
        body: {
          teamId,
          ...(target === 'new' && userMd !== (template.userMd ?? '') ? { userMd } : {}),
        },
      })
      onSpawned(teamId)
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={`Use ${template.name}`}
      description={`Creates ${count(template.slots.length, 'Agent')} and ${count(template.edges.length, 'connection')} between them.`}
      busy={busy}
      onClose={onClose}
      className="max-w-xl"
    >
      <form onSubmit={(event) => void spawn(event)} className="grid gap-4">
        <ChoiceCards
          legend="Into"
          name="spawn-team-target"
          value={target}
          disabled={busy}
          options={[
            {
              value: 'new',
              label: 'A new Team',
              hint: `${MODE_SENTENCE[template.policyMode]}, as in the template.`,
            },
            {
              value: 'existing',
              label: 'A Team that exists',
              hint: 'The Agents join it; it keeps its own messaging rules.',
            },
          ]}
          onChange={setTarget}
        />
        {target === 'new' ? (
          <>
            <TextField
              label="ID of the new Team"
              value={newId}
              disabled={busy}
              placeholder="launch"
              mono
              className="max-w-none"
              problem={idProblem}
              onChange={setNewId}
            />
            <div>
              <label
                htmlFor="spawn-team-user-md"
                className="m-0 text-sm font-semibold text-foreground"
              >
                USER.md
              </label>
              <textarea
                id="spawn-team-user-md"
                rows={4}
                value={userMd}
                disabled={busy}
                onChange={(event) => setUserMd(event.target.value)}
                className="mt-1.5 font-mono text-sm leading-[1.55]"
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                What every Agent of the new Team knows about you. It starts from the template’s.
              </span>
            </div>
          </>
        ) : (
          <SelectField
            label="Team"
            value={existing}
            options={teams.map((team) => ({ value: team.id, label: team.name }))}
            disabled={busy}
            className="max-w-none"
            onChange={setExisting}
          />
        )}
        {template.slots.length === 0 && (
          <Notice tone="warning">This template has no Agents yet: add some to it first.</Notice>
        )}
        {error && (
          <Notice tone="warning" role="alert" title="The Agents were not added.">
            {error}
          </Notice>
        )}
        <DialogActions>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy || !ready}>
            {busy ? 'Adding…' : `Add ${count(template.slots.length, 'Agent')}`}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
