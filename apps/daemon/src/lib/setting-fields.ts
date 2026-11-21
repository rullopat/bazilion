// The stored state of the settings a provider or service declares, as Setup and `bazilion config`
// show it: plaintext values as they are, secrets as "set" with a short preview.

import type { ServiceFieldState } from '@bazilion/api-types'
import { type BazilionDb, openConfig, openSecrets } from '../core/index.ts'
import type { ServiceField } from '../core/services.ts'

export interface StoredSettings {
  config: Record<string, string>
  secrets: Record<string, string>
}

function readAll(read: () => Record<string, string>): Record<string, string> {
  try {
    return read()
  } catch {
    return {}
  }
}

/** Every stored setting; a store that cannot be read counts as empty. */
export function readStoredSettings(db: BazilionDb, authToken: string): StoredSettings {
  return {
    config: readAll(() => openConfig(db).getAll()),
    secrets: readAll(() => openSecrets(db, authToken).getAll()),
  }
}

function mask(value: string): string {
  if (value.length === 0) return ''
  return value.length > 8 ? `${value.slice(0, 6)}…` : '***'
}

export function fieldStates(
  fields: readonly ServiceField[],
  stored: StoredSettings,
): ServiceFieldState[] {
  return fields.map((field) => {
    const value = (field.kind === 'config' ? stored.config : stored.secrets)[field.envVar] ?? ''
    const state: ServiceFieldState = {
      envVar: field.envVar,
      kind: field.kind,
      label: field.label,
      set: value.length > 0,
      ...(field.placeholder ? { placeholder: field.placeholder } : {}),
      ...(field.description ? { description: field.description } : {}),
      ...(field.options ? { options: field.options } : {}),
      ...(field.optionLabels ? { optionLabels: field.optionLabels } : {}),
      ...(field.advanced ? { advanced: true } : {}),
    }
    if (field.kind === 'config') state.value = value
    else if (value.length > 0) state.preview = mask(value)
    return state
  })
}

/** Write one setting to its store; an empty value clears it. */
export function writeSetting(
  db: BazilionDb,
  authToken: string,
  field: Pick<ServiceField, 'envVar' | 'kind'>,
  value: string,
): void {
  const store = field.kind === 'config' ? openConfig(db) : openSecrets(db, authToken)
  if (value === '') store.remove(field.envVar)
  else store.set(field.envVar, value)
}
