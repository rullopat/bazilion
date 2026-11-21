// Setup (`/config`): model providers, the models Agents may use, service cards and their fields.

/** One stored field of a provider or service card; SERVICES in apps/daemon/src/core/services.ts. */
export interface ServiceFieldState {
  options?: readonly string[]
  optionLabels?: Readonly<Record<string, string>>
  envVar: string
  kind: 'secret' | 'config'
  label: string
  placeholder?: string
  description?: string
  /** A field most installations never set; the web shows it under "More settings". */
  advanced?: boolean
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

export interface ServiceConfigResponse {
  services: ServiceCard[]
  /** Model functions (image generation): chosen on the Models page, listed by `config list`. */
  functions: ServiceCard[]
}

export interface SetFieldRequest {
  value: string
}

// ─── Providers ───────────────────────────────────────────────────────────

/**
 * What a provider is doing for Agents: `working` and `failing` are the outcome of its last test,
 * `untested` has none, `incomplete` is switched on without credentials, `off` is paused.
 */
export type ProviderState = 'working' | 'failing' | 'untested' | 'incomplete' | 'off'

export type ProviderFailureKind = 'credentials' | 'unreachable' | 'model' | 'limit' | 'other'

/** A failed test in plain words, with the provider's own message kept as `detail`. */
export interface ProviderFailure {
  kind: ProviderFailureKind
  /** What happened, in one line. */
  title: string
  /** What to do about it. */
  hint: string
  /** The provider's own words, with stored credentials removed. */
  detail: string
}

/** The last time a provider was asked for a short reply. */
export interface ProviderCheck {
  ok: boolean
  /** When, in Unix ms. */
  at: number
  /** The model that was asked, without the provider prefix. */
  model: string
  /** That model's name, when the bundled catalog has one. */
  modelName?: string
  /** How long the reply took, when one came. */
  ms?: number
  failure?: ProviderFailure
}

export interface ProviderConfigEntry {
  id: string
  displayName: string
  hint?: string
  /** `signin`: a browser sign-in; `local`: a model server on this network; `fields`: typed in. */
  connect: 'signin' | 'local' | 'fields'
  /** Where the "Add a provider" list puts it. */
  group: 'popular' | 'local' | 'more'
  fields: ServiceFieldState[]
  /** Its credentials are present; a local server needs none. */
  configured: boolean
  /** Agents may use it. */
  enabled: boolean
  /** It belongs on the Models page: switched on, or holding credentials or models. */
  listed: boolean
  state: ProviderState
  check?: ProviderCheck
  /** The chat models Agents may use, as model ids. */
  models: string[]
  /** The models the connect form ticks to begin with. */
  suggested: string[]
  /** How many chat models the bundled catalog has for it. */
  catalogSize: number
  /** It reports its own model list (local servers and some hosted APIs). */
  listsModels: boolean
  /** A local server's address in use. */
  address?: string
  /** The ChatGPT account id of a sign-in, when the token carries one. */
  account?: string
}

export interface ProviderConfigResponse {
  providers: ProviderConfigEntry[]
}

/** One model a provider offers, with what the bundled catalog knows about it. */
export interface CatalogModel {
  id: string
  /** The name people know it by; absent for models only the server reported. */
  name?: string
  /** Tokens it can read in one request. */
  contextWindow?: number
  /** It takes images as input. */
  images?: boolean
  reasoning?: boolean
  /** List price in US dollars per million tokens; absent when the catalog has none. */
  price?: { input: number; output: number }
  /** A dated copy of another model in the same list. */
  dated?: boolean
  /** Agents may use it. */
  selected: boolean
  suggested: boolean
}

/** `GET|POST /api/config/providers/:id/catalog`. */
export interface ProviderCatalogResponse {
  models: CatalogModel[]
  /** Why the provider's own model list could not be read, when it has one. */
  listError?: string
}

/** `POST /api/config/providers/:id/catalog`: list with field values that are not saved yet. */
export interface ProviderCatalogRequest {
  fields?: Record<string, string>
}

/** `POST /api/config/providers/:id/connect`. */
export interface ConnectProviderRequest {
  /** Values for the provider's fields, by setting name; a field left out keeps its value. */
  fields?: Record<string, string>
  /** The chat models to offer. Left out: the provider's suggested models. */
  models?: string[]
  /** `false` saves without asking a model for a reply. */
  test?: boolean
}

export type ConnectProviderResponse =
  | {
      connected: true
      provider: ProviderConfigEntry
      /** Null when nothing was tested. */
      check: ProviderCheck | null
      /** Models the provider refused for this account; they were left out. */
      dropped: { model: string; detail: string }[]
      /** Agent templates moved off a model this call removed. */
      movedTemplates: { id: string; name: string; model: string }[]
    }
  | {
      /** Nothing was saved. */
      connected: false
      failure: ProviderFailure
    }

/** `POST /api/config/providers/:id/test`. */
export interface TestProviderResponse {
  check: ProviderCheck
  provider: ProviderConfigEntry
}

/** `GET /api/config/providers/local`: the model servers found at their usual addresses. */
export interface LocalProvidersResponse {
  servers: {
    id: string
    displayName: string
    address: string
    found: boolean
    models: string[]
  }[]
}

export interface SetProviderModelsRequest {
  models: string[]
}

export interface SetProviderModelsResponse {
  models: string[]
  /** Agent templates the edit moved off a model it removed, with the model each now uses. */
  movedTemplates: { id: string; name: string; model: string }[]
}

export interface SetProviderEnabledResponse {
  name: string
  enabled: boolean
}

// ─── Models by function ──────────────────────────────────────────────────

/** A chat model Agents may use, as the Models page lists it. */
export interface ChatModelEntry extends CatalogModel {
  /** The `provider:model` string Agents and templates store. */
  value: string
  provider: string
  providerName: string
  providerConnect: ProviderConfigEntry['connect']
  providerState: ProviderState
  /** Who runs on it: Agents that are not archived, and Agent templates by name. */
  usedBy: { agents: number; templates: string[] }
}

/** One way to generate images: a model through one provider's account. */
export interface ImageRouteEntry {
  /** The value of BAZILION_IMAGE_MODEL that selects it. */
  id: string
  model: string
  provider: string
  providerName: string
  /** Who pays, in a few words. */
  billing: string
  ready: boolean
  /** What is missing when it is not ready. */
  needs?: string
}

/** `GET /api/config/models`: what Agents think and draw with. */
export interface ModelsResponse {
  chat: ChatModelEntry[]
  images: {
    /** The selected route's id, or `off`. */
    selected: string
    routes: ImageRouteEntry[]
  }
}

/** The chat models of one provider Agents may use. */
export interface ModelGroup {
  provider: string
  models: string[]
}

/** `GET /api/config/available-models`: chat models grouped by provider (under `teams`). */
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
