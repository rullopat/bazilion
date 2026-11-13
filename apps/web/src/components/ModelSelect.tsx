import type { ModelGroup } from '@bazilion/api-types'

/** Curated chat models grouped by provider: an AvailableModelsResponse. */
export const AVAILABLE_MODELS_PATH = '/api/config/available-models'

/**
 * A labelled `provider:model` picker over the curated models. `emptyOption` labels the "no choice"
 * entry (for example "Use the template default"); a value outside the curated list stays selectable.
 */
export function ModelSelect({
  label,
  value,
  onChange,
  groups,
  emptyOption,
  required,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  groups: ModelGroup[]
  emptyOption?: string
  required?: boolean
}) {
  const curated = groups.some((group) =>
    group.models.some((model) => `${group.provider}:${model}` === value),
  )
  return (
    <label>
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        className="min-w-0"
      >
        {emptyOption !== undefined ? (
          <option value="">{emptyOption}</option>
        ) : (
          !value && (
            <option value="" disabled>
              {groups.length === 0 ? 'No curated models: enable one under Setup' : 'Pick a model'}
            </option>
          )
        )}
        {value && !curated && <option value={value}>{value} (not curated)</option>}
        {groups.map((group) => (
          <optgroup key={group.provider} label={group.provider}>
            {group.models.map((model) => {
              const choice = `${group.provider}:${model}`
              return (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              )
            })}
          </optgroup>
        ))}
      </select>
    </label>
  )
}
