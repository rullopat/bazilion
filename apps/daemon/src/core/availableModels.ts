// Enumerates models that agents are actually allowed to use right now:
// every curated model of every currently-enabled provider.
//
// A provider must be both (a) toggled on in `provider_state` AND (b) have
// at least one curated entry in `provider_models` to show up here.

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
 * True once the user has at least one usable model — i.e. at least one enabled
 * provider with at least one curated model. Gates the first-run flow.
 */
export function isSetupComplete(db: BazilionDb): boolean {
  return listAvailableModels(db).length > 0
}
