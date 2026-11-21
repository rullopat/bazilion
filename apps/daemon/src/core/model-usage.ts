// Who runs on which chat model: Setup shows it beside each model so that removing one is a
// decision made with the Agents it affects in view.

import type { BazilionDb } from './db/client.ts'
import * as agentRepo from './repos/agents.ts'
import * as profileRepo from './repos/profiles.ts'

export interface ModelUsage {
  /** Agents that are not archived and resolve to this model. */
  agents: number
  /** Agent templates whose default model it is, by name. */
  templates: string[]
}

/** Usage by `provider:model`; a model nobody uses has no entry. */
export function modelUsage(db: BazilionDb): Map<string, ModelUsage> {
  const usage = new Map<string, ModelUsage>()
  const entry = (model: string): ModelUsage => {
    let found = usage.get(model)
    if (!found) {
      found = { agents: 0, templates: [] }
      usage.set(model, found)
    }
    return found
  }
  const defaults = new Map<string, string>()
  for (const profile of profileRepo.list(db)) {
    defaults.set(profile.id, profile.defaultModel)
    entry(profile.defaultModel).templates.push(profile.name)
  }
  for (const agent of agentRepo.list(db)) {
    const model = agent.modelOverride ?? defaults.get(agent.profileId)
    if (model) entry(model).agents += 1
  }
  return usage
}
