// Enumerates models that agents are actually allowed to use right now:
// every curated model of every currently-enabled provider. Drives the model
// dropdowns on the profile and agent forms.
//
// A provider must be both (a) toggled on in `provider_state` AND (b) have
// at least one curated entry in `provider_models` to show up here. Drop a
// provider off either side and it disappears from the list without a UI
// edit — the dropdowns are entirely data-driven.

import type { BazilionDb } from './db/client.ts'
import * as providerModelRepo from './repos/providerModels.ts'
import * as providerStateRepo from './repos/providerState.ts'

export interface AvailableModel {
  provider: string
  model: string
  /** The `provider:model` string used as the form value and in model resolution. */
  value: string
}

/**
 * Flat list of `{provider, model, value}` for every curated model of every
 * enabled provider. Iteration order: providers as they're stored in
 * `provider_state` (by insertion time), models as curated (preserving the
 * admin's ordering from the textarea).
 */
export function listAvailableModels(db: BazilionDb): AvailableModel[] {
  const enabled = providerStateRepo.listEnabled(db)
  const out: AvailableModel[] = []
  for (const provider of enabled) {
    for (const model of providerModelRepo.list(db, provider)) {
      out.push({ provider, model, value: `${provider}:${model}` })
    }
  }
  return out
}

/**
 * Same as `listAvailableModels` but grouped by provider — the shape the web
 * dropdowns consume directly via `<optgroup>`.
 */
export function groupAvailableModels(db: BazilionDb): { provider: string; models: string[] }[] {
  const enabled = providerStateRepo.listEnabled(db)
  const groups: { provider: string; models: string[] }[] = []
  for (const provider of enabled) {
    const models = providerModelRepo.list(db, provider)
    if (models.length > 0) groups.push({ provider, models })
  }
  return groups
}

/**
 * True once the user has at least one usable model — i.e. at least one enabled
 * provider with at least one curated model. Gates the first-run flow.
 */
export function isSetupComplete(db: BazilionDb): boolean {
  return listAvailableModels(db).length > 0
}
