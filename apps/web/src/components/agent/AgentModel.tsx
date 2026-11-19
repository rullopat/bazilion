import {
  type AvailableModelsResponse,
  REASONING_LEVELS,
  type ReasoningLevel,
  type ResolvedAgent,
} from '@bazilion/api-types'
import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { useResource } from '../../lib/use-resource'
import { Button } from '../Button'
import { AVAILABLE_MODELS_PATH, ModelSelect } from '../ModelSelect'

/** The model and reasoning level of one Agent, over its template's defaults. */
export function AgentModel({ agent }: { agent: ResolvedAgent }) {
  const router = useRouter()
  const models = useResource(
    (signal) => api<AvailableModelsResponse>(AVAILABLE_MODELS_PATH, { signal }),
    [],
  )
  const savedModel = agent.agent.modelOverride ?? ''
  const [model, setModel] = useState(savedModel)
  const [reasoning, setReasoning] = useState<ReasoningLevel>(agent.reasoningLevel)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = model !== savedModel || reasoning !== agent.reasoningLevel

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await api(`/api/agents/${encodeURIComponent(agent.agent.id)}`, {
        method: 'PATCH',
        body: { modelOverride: model || null, reasoningLevel: reasoning },
      })
      // Wait for the page's data: the form is unchanged once it holds what was saved.
      await router.invalidate({ sync: true })
      setSaved(true)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(event) => void save(event)} className="[&_label]:mt-0">
      <ModelSelect
        label="Model"
        value={model}
        onChange={(value) => {
          setModel(value)
          setSaved(false)
        }}
        groups={models.data?.teams ?? []}
        emptyOption={`The template's (${agent.profile.defaultModel})`}
      />
      <label>
        Reasoning
        <select
          value={reasoning}
          onChange={(event) => {
            setReasoning(event.target.value as ReasoningLevel)
            setSaved(false)
          }}
        >
          {REASONING_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" type="submit" disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        {saved && !dirty && (
          <span role="status" className="text-sm text-success">
            Saved. It applies from the next turn.
          </span>
        )}
        {(error ?? models.error) && (
          <span role="alert" className="text-sm text-danger">
            {error ?? models.error}
          </span>
        )}
      </div>
    </form>
  )
}
