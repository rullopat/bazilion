// Setup (`/config`): model providers, the models Agents may use, the tools and their settings.

export interface SettingOption {
  value: string
  label: string
  /** One line about what choosing it means. */
  hint?: string
  /** What choosing it would meet on this installation right now, such as a key that is missing. */
  note?: { text: string; tone: 'ok' | 'warning' }
}

/**
 * How a setting is entered and checked. Every setting is stored as text under its `envVar`:
 * a switch as its `on` or `off` value, a number in its base unit (`scale` shown units each).
 */
export type SettingInput =
  | { type: 'text' }
  | { type: 'choice'; options: SettingOption[]; default: string }
  | { type: 'switch'; on: string; off: string; default: boolean }
  | {
      type: 'number'
      default: number
      min: number
      max: number
      /** The unit people read, e.g. `minutes`; the stored number is `scale` times what they type. */
      unit?: string
      scale?: number
    }

/** One stored setting of a provider, a tool or a model function; SERVICES in core/services.ts. */
export interface ServiceFieldState {
  envVar: string
  kind: 'secret' | 'config'
  label: string
  placeholder?: string
  description?: string
  /** A setting most installations never touch; the web shows it under "More settings". */
  advanced?: boolean
  input: SettingInput
  /** True when the setting has a non-empty value in its storage backend. */
  set: boolean
  /** For `kind: 'config'` (plaintext): the stored value. Omitted for secrets. */
  value?: string
  /** For `kind: 'secret'`: a truncated preview like "sk-abc…". Omitted when unset. */
  preview?: string
  /**
   * What is in effect, read as the daemon reads it: the default when nothing valid is stored.
   * Omitted for secrets.
   */
  effective?: string
  /**
   * The stored value is one the daemon cannot use, so something else is in effect: a mistyped
   * mode or number saved before values were checked. Saving the card replaces it.
   */
  unusable?: boolean
  /** The daemon's own environment sets this, which wins over what is stored here. */
  environment?: boolean
  /** It matters only while these other settings of its card have one of these values. */
  when?: { envVar: string; is: string[] }[]
}

/** What a tool is doing now, in a few words. */
export interface ServiceState {
  label: string
  tone: 'on' | 'warning' | 'off'
}

export interface ServiceCard {
  id: string
  displayName: string
  hint?: string
  /** What is in effect now. */
  state?: ServiceState
  /** A further line, such as whether Docker has the image, or why a model function is not ready. */
  note?: string
  /** Something worth knowing that is not a setting of the card. */
  footnote?: string
  fields: ServiceFieldState[]
}

/** `GET /api/config/tools` */
export interface ToolsResponse {
  /** What Agents can do besides thinking: search, read pages, browse, run commands. */
  tools: ServiceCard[]
  /** Model functions (image generation): chosen on the Models page, listed by `config list`. */
  functions: ServiceCard[]
}

export interface SetFieldRequest {
  value: string
}

/** `PUT /api/config/fields`: several settings saved together; an empty value clears one. */
export interface SetFieldsRequest {
  values: Record<string, string>
}

export interface SetFieldsResponse {
  fields: ServiceFieldState[]
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
  window: ModelWindow
}

/** How many tokens a chat model reads in one request, and what says so. */
export interface ModelWindow {
  /** Null when nothing says it: turns on the model are refused until a window is set. */
  tokens: number | null
  /**
   * Pi's bundled catalog; the model's server (a local server says what it loaded the model with);
   * or the value set by hand. Null with `tokens`.
   */
  source: 'catalog' | 'server' | 'set' | null
  /** The value set by hand: used when neither the catalog nor the server says the window. */
  set: number | null
  /** A value may be set by hand: the catalog does not know the model. */
  settable: boolean
}

/** `PUT /api/config/models/window`: set a chat model's window by hand, or forget it (`null`). */
export interface SetModelWindowRequest {
  /** The `provider:model` string. */
  model: string
  tokens: number | null
}

export interface SetModelWindowResponse {
  window: ModelWindow
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
