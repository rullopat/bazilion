// The model and reasoning level of one Agent, over its template's defaults. A choice is saved as
// soon as it is made, with an Undo for the one before.

import {
  type ModelsResponse,
  REASONING_LEVELS,
  type ReasoningLevel,
  type ResolvedAgent,
} from '@bazilion/api-types'
import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { modelName } from '../../lib/model-facts'
import { useResource } from '../../lib/use-resource'
import { Button } from '../Button'
import { MODELS_PATH, ModelMenu } from '../ModelMenu'
import { SelectField } from '../ui/form'

interface Choice {
  model: string
  reasoning: ReasoningLevel
}

export function AgentModel({ agent }: { agent: ResolvedAgent }) {
  const router = useRouter()
  const models = useResource((signal) => api<ModelsResponse>(MODELS_PATH, { signal }), [])
  const stored: Choice = {
    model: agent.agent.modelOverride ?? '',
    reasoning: agent.reasoningLevel,
  }
  // What is on screen: the stored choice, or the one being saved.
  const [shown, setShown] = useState<Choice>(stored)
  const [saving, setSaving] = useState(false)
  // The choice before the last change, for Undo, and what that change was.
  const [undo, setUndo] = useState<{ before: Choice; what: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function save(next: Choice, what: string | null) {
    const before = shown
    setShown(next)
    setSaving(true)
    setError(null)
    try {
      await api(`/api/agents/${encodeURIComponent(agent.agent.id)}`, {
        method: 'PATCH',
        body: { modelOverride: next.model || null, reasoningLevel: next.reasoning },
      })
      await router.invalidate({ sync: true })
      setUndo(what ? { before, what } : null)
    } catch (cause) {
      setShown(before)
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  const modelLabel = (value: string) => {
    if (value === '') return 'the template’s model'
    const model = models.data?.chat.find((entry) => entry.value === value)
    return model ? modelName(model) : value
  }

  return (
    <div className="grid gap-3">
      <ModelMenu
        kit
        disabled={saving}
        label="Model"
        value={shown.model}
        onChange={(value) => {
          if (value !== shown.model)
            void save({ ...shown, model: value }, `Model set to ${modelLabel(value)}`)
        }}
        models={models.data?.chat ?? []}
        inherited={{ label: 'The template’s model', model: agent.profile.defaultModel }}
      />
      <SelectField<ReasoningLevel>
        label="Reasoning"
        value={shown.reasoning}
        options={REASONING_LEVELS.map((level) => ({ value: level, label: level }))}
        disabled={saving}
        className="max-w-none"
        onChange={(value) => {
          if (value !== shown.reasoning)
            void save({ ...shown, reasoning: value }, `Reasoning set to ${value}`)
        }}
      />
      <p
        role="status"
        className={`m-0 flex min-h-8 flex-wrap items-center gap-x-2 text-sm ${error ? 'text-warning' : 'text-success'}`}
      >
        {error ? (
          `Not saved: ${error}`
        ) : saving ? (
          <span className="text-muted-foreground">Saving…</span>
        ) : undo ? (
          <>
            <span>{undo.what}. It applies from the next turn.</span>
            <Button variant="ghost" onClick={() => void save(undo.before, null)}>
              Undo
            </Button>
          </>
        ) : (
          <span className="text-muted-foreground">Changes apply from the next turn.</span>
        )}
      </p>
      {models.error && (
        <p role="alert" className="m-0 text-sm text-warning">
          The models could not be loaded: {models.error}
        </p>
      )}
    </div>
  )
}
