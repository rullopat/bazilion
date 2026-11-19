// Replacing a provider's curated model list, and what the edit does to Agent templates.

import type { SetProviderModelsResponse } from '@bazilion/api-types'
import { listAvailableModels } from './availableModels.ts'
import type { BazilionDb } from './db/client.ts'
import * as profileRepo from './repos/profiles.ts'
import * as providerModelRepo from './repos/providerModels.ts'

/**
 * Replace `provider`'s curated models. An Agent template whose default model this edit removed
 * moves to the provider's first remaining model, or to the first available model of another
 * provider when none remains: the default template is seeded from this list, so a corrected list
 * would otherwise leave new Agents on the model that was taken out. A template on a model that was
 * never curated is left alone, and so is every template when no model is available to move to.
 */
export function replaceCuratedModels(
  db: BazilionDb,
  provider: string,
  models: string[],
): SetProviderModelsResponse {
  const before = providerModelRepo.list(db, provider)
  providerModelRepo.replace(db, provider, models)
  const after = providerModelRepo.list(db, provider)

  const removed = new Set(
    before.filter((model) => !after.includes(model)).map((model) => `${provider}:${model}`),
  )
  const target = after[0] ? `${provider}:${after[0]}` : listAvailableModels(db)[0]?.value
  const movedTemplates: SetProviderModelsResponse['movedTemplates'] = []
  if (target) {
    for (const profile of profileRepo.list(db)) {
      if (!removed.has(profile.defaultModel)) continue
      profileRepo.update(db, profile.id, {
        name: profile.name,
        defaultModel: target,
        skillsMode: profile.skillsMode,
      })
      movedTemplates.push({ id: profile.id, name: profile.name, model: target })
    }
  }
  return { models: after, movedTemplates }
}
