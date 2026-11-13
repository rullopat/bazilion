import {
  type AvailableModelsResponse,
  type ModelGroup,
  REASONING_LEVELS,
  type ReasoningLevel,
  type SkillInfo,
  type Team,
  type TelegramConfigState,
} from '@bazilion/api-types'
import { createFileRoute, getRouteApi, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { AgentBrowserCard } from '../../../components/AgentBrowserCard'
import { AgentSkills } from '../../../components/AgentSkills'
import { AgentTelegram } from '../../../components/AgentTelegram'
import { Button } from '../../../components/Button'
import { AVAILABLE_MODELS_PATH, ModelSelect } from '../../../components/ModelSelect'
import { SectionCard } from '../../../components/Page'
import { api, errorMessage } from '../../../lib/api'
import { daemonClient } from '../../../lib/daemon-client'

const agentRoute = getRouteApi('/agents/$id')

const fetchSettings = createServerFn({ method: 'GET' }).handler(async () => {
  const client = daemonClient()
  const [teams, skills, models, telegram] = await Promise.all([
    client.get<Team[]>('/api/teams'),
    client.get<SkillInfo[]>('/api/skills'),
    client.get<AvailableModelsResponse>(AVAILABLE_MODELS_PATH),
    client
      .get<TelegramConfigState>('/api/config/telegram')
      .catch(() => ({ configured: false }) as TelegramConfigState),
  ])
  return { teams, skills, modelGroups: models.teams, telegramConfigured: telegram.configured }
})

export const Route = createFileRoute('/agents/$id/settings')({
  loader: () => fetchSettings(),
  component: AgentSettingsPage,
})

function AgentSettingsPage() {
  const resolved = agentRoute.useLoaderData()
  const { teams, skills, modelGroups, telegramConfigured } = Route.useLoaderData()
  const { agent } = resolved
  return (
    <div className="space-y-6">
      <AgentBrowserCard agentId={agent.id} />
      <ModelSettings
        agentId={agent.id}
        modelOverride={agent.modelOverride ?? null}
        templateModel={resolved.profile.defaultModel}
        reasoning={resolved.reasoningLevel}
        modelGroups={modelGroups}
      />
      <SectionCard
        title="Team"
        description="Move this Agent to another Team workspace. It leaves its allow edges behind and joins with none."
      >
        <p className="text-[0.9em] text-mocha-light">
          Current team: <code>{resolved.team.id}</code> ({resolved.team.name}) —{' '}
          <code>{resolved.team.path}</code>.{' '}
          <a href={`/teams/${encodeURIComponent(resolved.team.id)}`}>View or edit USER.md</a>
        </p>
        <MoveTeamForm agentId={agent.id} currentTeamId={resolved.team.id} teams={teams} />
      </SectionCard>
      <SectionCard title="Skills" description="Attach or detach prompt skills for this Agent.">
        <AgentSkills agentId={agent.id} attached={new Set(resolved.skills)} all={skills} />
      </SectionCard>
      {telegramConfigured && (
        <SectionCard
          title="Telegram"
          description="Bind this Agent to its Telegram topic and control mirroring."
        >
          <AgentTelegram agent={agent} />
        </SectionCard>
      )}
    </div>
  )
}

function ModelSettings({
  agentId,
  modelOverride,
  templateModel,
  reasoning: currentReasoning,
  modelGroups,
}: {
  agentId: string
  modelOverride: string | null
  templateModel: string
  reasoning: ReasoningLevel
  modelGroups: ModelGroup[]
}) {
  const router = useRouter()
  const [model, setModel] = useState(modelOverride ?? '')
  const [reasoning, setReasoning] = useState(currentReasoning)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await api(`/api/agents/${encodeURIComponent(agentId)}`, {
        method: 'PATCH',
        body: { modelOverride: model || null, reasoningLevel: reasoning },
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
      await router.invalidate()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard
      title="Model and reasoning"
      description="Override the Agent template defaults for this Agent only."
    >
      <form onSubmit={(event) => void save(event)} className="grid gap-x-4 sm:grid-cols-2">
        <ModelSelect
          label="Model override"
          value={model}
          onChange={setModel}
          groups={modelGroups}
          emptyOption={`Inherit from the template (${templateModel})`}
        />
        <label>
          Reasoning level
          <select
            value={reasoning}
            onChange={(event) => setReasoning(event.target.value as ReasoningLevel)}
          >
            {REASONING_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button variant="primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save model settings'}
          </Button>
          {saved && (
            <span role="status" className="text-sm text-success">
              Saved
            </span>
          )}
          {error && (
            <span role="alert" className="text-sm text-danger">
              {error}
            </span>
          )}
        </div>
      </form>
    </SectionCard>
  )
}

function MoveTeamForm({
  agentId,
  currentTeamId,
  teams,
}: {
  agentId: string
  currentTeamId: string
  teams: Team[]
}) {
  const router = useRouter()
  const [teamId, setTeamId] = useState(currentTeamId)
  const [moving, setMoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function move(event: React.FormEvent) {
    event.preventDefault()
    setMoving(true)
    setError(null)
    try {
      await api(`/api/agents/${encodeURIComponent(agentId)}/team`, {
        method: 'PATCH',
        body: { teamId },
      })
      await router.invalidate()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setMoving(false)
    }
  }

  return (
    <form onSubmit={(event) => void move(event)} className="mt-2 flex flex-wrap items-end gap-2">
      <label className="m-0 min-w-0 flex-1">
        Move to
        <select value={teamId} onChange={(event) => setTeamId(event.target.value)}>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.id} — {team.path}
            </option>
          ))}
        </select>
      </label>
      <Button variant="primary" type="submit" disabled={moving || teamId === currentTeamId}>
        {moving ? 'Moving…' : 'Move'}
      </Button>
      {error && (
        <span role="alert" className="basis-full text-[0.85em] text-danger">
          {error}
        </span>
      )}
    </form>
  )
}
