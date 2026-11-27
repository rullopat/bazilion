// The settings a provider, a tool or a model function declares: their stored state as Setup and
// `bazilion config` show it (plaintext values as they are, secrets as "set" with a short preview),
// what is in effect, and the check a value passes before it is stored.

import { isAbsolute } from 'node:path'
import type { ServiceFieldState, SettingInput } from '@bazilion/api-types'
import { type BazilionDb, openConfig, openSecrets } from '../core/index.ts'
import type { FieldInput, ServiceField } from '../core/services.ts'

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

const TEXT: FieldInput = { type: 'text' }
// The spellings the daemon reads as "no" in a yes/no setting; anything else non-empty is "yes".
const FALSEY = new Set(['false', '0', 'no', 'off'])
const TRUTHY = new Set(['true', '1', 'yes', 'on'])
// The same pattern the shell settings are read with (`runtime/shell/security.ts`).
const DOCKER_IMAGE = /^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/

/** A setting that is yes or no under any of its spellings, whichever way round it is shown. */
function isYesNo(values: readonly string[]): boolean {
  return values.length === 2 && values.includes('true') && values.includes('false')
}

function yesNo(raw: string): 'true' | 'false' {
  return FALSEY.has(raw.toLowerCase()) ? 'false' : 'true'
}

/**
 * `raw` read as the daemon reads the setting: the canonical value in effect, or the default when
 * nothing usable is there. A switch gives its `on` or `off` value, a number its base-unit digits.
 */
export function effectiveValue(input: FieldInput, raw: string): string {
  const value = raw.trim()
  switch (input.type) {
    case 'text':
      return value
    case 'choice': {
      const options = input.options.map((option) => option.value)
      if (value === '') return input.default
      if (isYesNo(options)) return yesNo(value)
      return options.includes(value) ? value : input.default
    }
    case 'switch': {
      if (value === '') return input.default ? input.on : input.off
      if (isYesNo([input.on, input.off])) return yesNo(value)
      return value === input.on ? input.on : input.off
    }
    case 'number': {
      const parsed = /^\d+/.test(value) ? Number.parseInt(value, 10) : Number.NaN
      // A stored number outside the range offered here still counts: it was accepted once.
      const usable = Number.isSafeInteger(parsed) && (parsed > 0 || input.min === 0)
      return String(usable ? parsed : input.default)
    }
  }
}

/**
 * The value to store for what was typed, or why it cannot be stored. An empty value clears the
 * setting. Yes/no settings accept their usual spellings and are stored as `true` or `false`.
 */
export function normalizeSetting(
  field: Pick<ServiceField, 'envVar' | 'kind' | 'input'>,
  raw: string,
): { value: string } | { error: string } {
  const value = raw.trim()
  if (value === '') return { value: '' }
  const input = field.input ?? TEXT
  const name = field.envVar
  switch (input.type) {
    case 'text':
      if (input.format === 'url') {
        let protocol = ''
        try {
          protocol = new URL(value).protocol
        } catch {}
        if (protocol !== 'http:' && protocol !== 'https:') {
          return { error: `${name} must be an address that starts with http:// or https://` }
        }
      } else if (input.format === 'path' && !isAbsolute(value)) {
        return { error: `${name} must be a full path, such as /usr/bin/chromium` }
      } else if (input.format === 'docker-image' && !DOCKER_IMAGE.test(value)) {
        return { error: `${name} is not a Docker image name, such as debian:bookworm-slim` }
      } else if (input.format === 'model' && !/^[a-z0-9-]+:\S+$/.test(value)) {
        return { error: `${name} must be a model as provider:model, such as openai:gpt-5-mini` }
      }
      // A secret is stored as pasted, without the blanks around it.
      return { value }
    case 'choice': {
      const options = input.options.map((option) => option.value)
      const lower = value.toLowerCase()
      if (isYesNo(options) && (TRUTHY.has(lower) || FALSEY.has(lower))) {
        return { value: yesNo(value) }
      }
      return options.includes(value)
        ? { value }
        : { error: `${name} must be one of: ${options.join(', ')}` }
    }
    case 'switch': {
      const lower = value.toLowerCase()
      if (isYesNo([input.on, input.off])) {
        return TRUTHY.has(lower) || FALSEY.has(lower)
          ? { value: yesNo(value) }
          : { error: `${name} must be true or false` }
      }
      return value === input.on || value === input.off
        ? { value }
        : { error: `${name} must be ${input.on} or ${input.off}` }
    }
    case 'number': {
      const parsed = Number(value)
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed)) {
        return { error: `${name} must be a whole number` }
      }
      if (parsed < input.min || parsed > input.max) {
        return { error: `${name} must be from ${input.min} to ${input.max}` }
      }
      return { value: String(parsed) }
    }
  }
}

function wireInput(input: FieldInput): SettingInput {
  switch (input.type) {
    case 'text':
      return { type: 'text' }
    case 'choice':
      return {
        type: 'choice',
        default: input.default,
        options: input.options.map((option) => ({ ...option })),
      }
    default:
      return { ...input }
  }
}

/**
 * Each field as stored, and what is in effect. `env` is the daemon's own environment, which wins
 * over the stores: a field it sets is marked, and its value there is the one in effect.
 */
export function fieldStates(
  fields: readonly ServiceField[],
  stored: StoredSettings,
  env: NodeJS.ProcessEnv = process.env,
): ServiceFieldState[] {
  return fields.map((field) => {
    const value = (field.kind === 'config' ? stored.config : stored.secrets)[field.envVar] ?? ''
    const fromEnvironment = env[field.envVar] ?? ''
    const input = field.input ?? TEXT
    const state: ServiceFieldState = {
      envVar: field.envVar,
      kind: field.kind,
      label: field.label,
      input: wireInput(input),
      set: value.length > 0,
      ...(field.placeholder ? { placeholder: field.placeholder } : {}),
      ...(field.description ? { description: field.description } : {}),
      ...(field.advanced ? { advanced: true } : {}),
      ...(field.when
        ? { when: field.when.map((rule) => ({ envVar: rule.envVar, is: [...rule.is] })) }
        : {}),
      ...(fromEnvironment.length > 0 ? { environment: true } : {}),
    }
    if (field.kind === 'config') {
      state.value = value
      state.effective = effectiveValue(input, fromEnvironment || value)
      // Stored before values were checked, and not what the daemon makes of it.
      if (
        value.length > 0 &&
        'error' in normalizeSetting(field, value) &&
        effectiveValue(input, value) !== value.trim()
      ) {
        state.unusable = true
      }
    } else if (value.length > 0) state.preview = mask(value)
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
  // A voice belongs to its speech model: another model starts again from its own first voice.
  if (field.envVar === 'BAZILION_SPEECH_MODEL' && (store.get(field.envVar) ?? '') !== value)
    openConfig(db).remove('BAZILION_SPEECH_VOICE')
  if (value === '') store.remove(field.envVar)
  else store.set(field.envVar, value)
}
