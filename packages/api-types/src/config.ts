// The /config page: providers, service cards and their fields.

/** One stored field of a provider or service card; SERVICES in apps/daemon/src/core/services.ts. */
export interface ServiceFieldState {
  options?: readonly string[]
  optionLabels?: Readonly<Record<string, string>>
  envVar: string
  kind: 'secret' | 'config'
  label: string
  placeholder?: string
  description?: string
  /** True when the field has a non-empty value in its storage backend. */
  set: boolean
  /** For `kind: 'config'` (plaintext): the actual value. Omitted for secrets. */
  value?: string
  /** For `kind: 'secret'`: a truncated preview like "sk-abc…". Omitted when unset. */
  preview?: string
}

export interface ServiceCard {
  status?: string
  id: string
  displayName: string
  hint?: string
  /** Display section label (e.g. "Web tools"); cards without one are shown under "Other". */
  team?: string
  fields: ServiceFieldState[]
}

export interface ProviderConfigEntry extends ServiceCard {
  /** The /config toggle: whether Agents may use this provider. */
  enabled: boolean
  /** Static catalog from pi-ai's typed model list — empty for providers not in the catalog. */
  catalog: string[]
  /** Live `/v1/models` query — omitted when the provider doesn't expose one. */
  live?: { models: string[]; error?: string }
  /** Curated models the admin has selected — drives the dropdowns in profile/agent forms. */
  curated: string[]
}

export interface ProviderConfigResponse {
  providers: ProviderConfigEntry[]
}

export interface ServiceConfigResponse {
  services: ServiceCard[]
}

export interface SetFieldRequest {
  value: string
}

export interface SetProviderModelsRequest {
  models: string[]
}

export interface SetProviderModelsResponse {
  models: string[]
}

export interface SetProviderEnabledResponse {
  name: string
  enabled: boolean
}

/** The curated models of one enabled provider. */
export interface ModelGroup {
  provider: string
  models: string[]
}

/** `GET /api/config/available-models`: curated chat models grouped by provider (under `teams`). */
export interface AvailableModelsResponse {
  teams: ModelGroup[]
}

export interface ProviderTestRequest {
  model: string
  message?: string
}

export interface ProviderTestResponse {
  content: string
  usage?: {
    promptTokens: number
    completionTokens: number
  }
}
