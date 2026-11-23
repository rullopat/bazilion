import {
  type Agent,
  agentNameProblem,
  type ChatModelEntry,
  DEFAULT_PROFILE_ID,
  DEFAULT_TEAM_ID,
  type ModelsResponse,
  type Profile,
  type SpawnAgentRequest,
  type Team,
} from '@bazilion/api-types'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { api, errorMessage } from '../lib/api'
import { Button } from './Button'
import { Dialog, DialogActions } from './Dialog'
import { MODELS_PATH, ModelMenu } from './ModelMenu'
import { SelectField, TextField } from './ui/form'
import { Notice } from './ui/parts'

/** The one way to spawn an Agent; opens its chat afterwards. */
export function SpawnDialog({
  profiles,
  teams,
  profileId: initialProfileId,
  teamId: initialTeamId,
  onClose,
}: {
  profiles: Profile[]
  teams: Team[]
  profileId?: string
  /** The Team to offer first, e.g. the one in view. */
  teamId?: string
  onClose: () => void
}) {
  const navigate = useNavigate()
  const [profileId, setProfileId] = useState(
    initialProfileId ??
      profiles.find((profile) => profile.id === DEFAULT_PROFILE_ID)?.id ??
      profiles[0]?.id ??
      '',
  )
  const [name, setName] = useState('')
  const nameProblem = name.trim() ? agentNameProblem(name.trim()) : null
  const [model, setModel] = useState('')
  const [chatModels, setChatModels] = useState<ChatModelEntry[]>([])
  const [teamId, setTeamId] = useState(
    teams.find((team) => team.id === initialTeamId)?.id ??
      teams.find((team) => team.id === DEFAULT_TEAM_ID)?.id ??
      teams[0]?.id ??
      '',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const restricted = teams.find((team) => team.id === teamId)?.policyMode === 'restricted'

  useEffect(() => {
    const controller = new AbortController()
    api<ModelsResponse>(MODELS_PATH, { signal: controller.signal })
      .then((response) => setChatModels(response.chat))
      .catch(() => {
        // Without the list of chat models the template default still applies.
      })
    return () => controller.abort()
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const request: SpawnAgentRequest = { profileId, teamId }
      if (name.trim()) request.name = name.trim()
      if (model) request.model = model
      const { agent } = await api<{ agent: Agent }>('/api/agents', { body: request })
      onClose()
      await navigate({ to: '/', search: { agent: agent.id } })
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  const template = profiles.find((profile) => profile.id === profileId)
  return (
    <Dialog
      title="Add an Agent"
      description="It starts with its template's files, model and skills, in the Team you choose."
      busy={busy}
      onClose={onClose}
    >
      <form onSubmit={(event) => void submit(event)} className="grid gap-4">
        <SelectField
          label="Agent template"
          value={profileId}
          options={profiles.map((profile) => ({
            value: profile.id,
            label: profile.name || profile.id,
          }))}
          disabled={busy}
          className="max-w-none"
          onChange={setProfileId}
        />
        <TextField
          label="Name"
          value={name}
          disabled={busy}
          placeholder={template?.name || template?.id || 'The template’s name'}
          hint="Leave it empty to use the template’s name."
          problem={nameProblem ?? undefined}
          className="max-w-none"
          onChange={setName}
        />
        <ModelMenu
          kit
          label="Model"
          value={model}
          onChange={setModel}
          models={chatModels}
          inherited={{ label: 'The template’s model', model: template?.defaultModel }}
        />
        <SelectField
          label="Team"
          value={teamId}
          options={teams.map((team) => ({
            value: team.id,
            label: team.id === DEFAULT_TEAM_ID ? `${team.name} (default)` : team.name,
          }))}
          disabled={busy}
          className="max-w-none"
          hint={
            restricted
              ? 'This Team is restricted: the new Agent starts with no connections. Add them under Connections.'
              : undefined
          }
          onChange={setTeamId}
        />
        {error && (
          <Notice tone="warning" role="alert" title="It was not spawned.">
            {error}
          </Notice>
        )}
        <DialogActions>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={busy || !profileId || !teamId || nameProblem !== null}
          >
            {busy ? 'Adding…' : 'Add the Agent'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
