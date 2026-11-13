import {
  type Agent,
  type AvailableModelsResponse,
  DEFAULT_PROFILE_ID,
  DEFAULT_TEAM_ID,
  type ModelGroup,
  type Profile,
  type SpawnAgentRequest,
  type Team,
} from '@bazilion/api-types'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { api, errorMessage } from '../lib/api'
import { Button } from './Button'
import { Dialog, DialogActions } from './Dialog'
import { AVAILABLE_MODELS_PATH, ModelSelect } from './ModelSelect'

/** The one way to spawn an Agent; opens its chat afterwards. */
export function SpawnDialog({
  profiles,
  teams,
  profileId: initialProfileId,
  onClose,
}: {
  profiles: Profile[]
  teams: Team[]
  profileId?: string
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
  const [model, setModel] = useState('')
  const [modelGroups, setModelGroups] = useState<ModelGroup[]>([])
  const [teamId, setTeamId] = useState(
    teams.find((team) => team.id === DEFAULT_TEAM_ID)?.id ?? teams[0]?.id ?? '',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const restricted = teams.find((team) => team.id === teamId)?.policyMode === 'restricted'

  useEffect(() => {
    const controller = new AbortController()
    api<AvailableModelsResponse>(AVAILABLE_MODELS_PATH, { signal: controller.signal })
      .then((response) => setModelGroups(response.teams))
      .catch(() => {
        // Without the curated list the template default still applies.
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

  return (
    <Dialog title="Spawn an agent" busy={busy} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)}>
        <label>
          Agent template
          <select value={profileId} onChange={(event) => setProfileId(event.target.value)} required>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name || profile.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Name (optional; defaults to the template's)
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
          />
        </label>
        <ModelSelect
          label="Model"
          value={model}
          onChange={setModel}
          groups={modelGroups}
          emptyOption="Use the template default"
        />
        <label>
          Team
          <select value={teamId} onChange={(event) => setTeamId(event.target.value)}>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
                {team.id === DEFAULT_TEAM_ID ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </label>
        {restricted && (
          <p className="text-xs text-muted-foreground">
            This Team is restricted: the new Agent starts with no allow edges. Add them on the Team
            policy page.
          </p>
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
            <Button variant="primary" type="submit" disabled={busy || !profileId}>
              {busy ? 'Spawning…' : 'Spawn agent'}
            </Button>
          </DialogActions>
        </div>
      </form>
    </Dialog>
  )
}
