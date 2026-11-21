// Model providers as Setup sees them: what each one's state is, the models it offers, and the
// three things that change it. Connecting tests before it saves, so a key that does not work is
// never stored and never switches a provider on.

import type {
  CatalogModel,
  ChatModelEntry,
  ConnectProviderRequest,
  ConnectProviderResponse,
  LocalProvidersResponse,
  ModelsResponse,
  OpenAICodexStatus,
  ProviderCatalogResponse,
  ProviderCheck,
  ProviderConfigEntry,
  ProviderFailure,
  ProviderState,
  SetProviderModelsResponse,
  TestProviderResponse,
} from '@bazilion/api-types'
import { DomainError } from '../core/errors.ts'
import { IMAGE_ROUTES, imageRouteNeeds, isImageModel } from '../core/image-generation-config.ts'
import {
  type BazilionDb,
  ensureSetupSeeded,
  mergeSecretsIntoEnv,
  type Paths,
  providerModelRepo,
  providerStateRepo,
  replaceCuratedModels,
} from '../core/index.ts'
import { modelUsage } from '../core/model-usage.ts'
import { readProviderChecks, writeProviderCheck } from '../core/provider-checks.ts'
import {
  findProvider,
  isProviderConfigured,
  PROVIDERS,
  type ProviderDef,
  providerEndpoint,
  providersUsingField,
} from '../core/providers.ts'
import {
  type CatalogEntry,
  clearOpenAICodexCredentials,
  datedCopies,
  getOpenAICodexStatus,
  listCatalogEntries,
  listLiveModels,
  loadOpenAICodexAccessToken,
  testProviderModel,
} from '../runtime/index.ts'
import { describeProviderFailure } from './provider-failure.ts'
import {
  fieldStates,
  readStoredSettings,
  type StoredSettings,
  writeSetting,
} from './setting-fields.ts'

export interface SetupCtx {
  db: BazilionDb
  authToken: string
  paths: Paths
}

const TEST_MESSAGE = 'Reply with one word: ready.'
/** A local model may still be loading; hosted APIs answer well inside this. */
const TEST_TIMEOUT_MS = 60_000
/** How many models a connect tries when the provider refuses the first for this account. */
const MAX_TEST_ATTEMPTS = 3
const LIST_TIMEOUT_MS = 4_000
const DISCOVERY_TIMEOUT_MS = 1_500
export const IMAGE_MODEL_AS_CHAT =
  'This is an image model: choose it under Images, not as a chat model.'

export function requireProvider(id: string): ProviderDef {
  const provider = findProvider(id)
  if (!provider) throw new DomainError(404, `unknown provider: ${id}`)
  return provider
}

function connectKind(provider: ProviderDef): ProviderConfigEntry['connect'] {
  if (provider.id === 'openai-codex') return 'signin'
  return provider.local ? 'local' : 'fields'
}

/** Chat models of Pi's catalog; image models have their own place. */
function chatCatalog(providerId: string): CatalogEntry[] {
  return listCatalogEntries(providerId).filter((model) => !isImageModel(providerId, model.id))
}

/**
 * The settings in effect if `overrides` were stored: saved values, then the overrides, then the
 * daemon's own environment, which always wins. An empty override clears the saved value.
 */
function effectiveEnv(
  { db, authToken }: SetupCtx,
  overrides: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...mergeSecretsIntoEnv(db, authToken, {}), ...overrides }
  for (const [name, value] of Object.entries(overrides)) if (value === '') delete env[name]
  return { ...env, ...process.env }
}

interface Snapshot {
  env: NodeJS.ProcessEnv
  stored: StoredSettings
  enabled: Set<string>
  checks: Record<string, ProviderCheck>
  codex: OpenAICodexStatus
}

function snapshot(ctx: SetupCtx): Snapshot {
  return {
    env: effectiveEnv(ctx),
    stored: readStoredSettings(ctx.db, ctx.authToken),
    enabled: providerStateRepo.listEnabled(ctx.db),
    checks: readProviderChecks(ctx.db),
    codex: getOpenAICodexStatus(ctx.db, ctx.authToken),
  }
}

function hasCredentials(provider: ProviderDef, env: NodeJS.ProcessEnv, codexConnected: boolean) {
  return provider.id === 'openai-codex' ? codexConnected : isProviderConfigured(provider.id, env)
}

function localAddress(provider: ProviderDef, env: NodeJS.ProcessEnv): string | undefined {
  if (!provider.local) return undefined
  return providerEndpoint(provider.id, env) ?? provider.endpoint?.fallback
}

function entryOf(provider: ProviderDef, snap: Snapshot, db: BazilionDb): ProviderConfigEntry {
  const connect = connectKind(provider)
  const configured = hasCredentials(provider, snap.env, snap.codex.connected)
  const enabled = snap.enabled.has(provider.id)
  const models = providerModelRepo.list(db, provider.id)
  const fields = fieldStates(provider.fields, snap.stored)
  const check = snap.checks[provider.id]
  let state: ProviderState = 'untested'
  if (!enabled) state = 'off'
  else if (!configured) state = 'incomplete'
  else if (check) state = check.ok ? 'working' : 'failing'
  const address = localAddress(provider, snap.env)
  return {
    id: provider.id,
    displayName: provider.displayName,
    ...(provider.hint ? { hint: provider.hint } : {}),
    connect,
    group: provider.popular ? 'popular' : provider.local ? 'local' : 'more',
    fields,
    configured,
    enabled,
    listed:
      enabled ||
      models.length > 0 ||
      fields.some((field) => field.set) ||
      (connect === 'signin' && configured),
    state,
    ...(check ? { check } : {}),
    models,
    suggested: [...(provider.suggested ?? [])],
    catalogSize: chatCatalog(provider.id).length,
    listsModels: Boolean(provider.local || provider.modelsUrl),
    ...(address ? { address } : {}),
    ...(connect === 'signin' && snap.codex.accountId ? { account: snap.codex.accountId } : {}),
  }
}

export function providerEntries(ctx: SetupCtx): ProviderConfigEntry[] {
  const snap = snapshot(ctx)
  return PROVIDERS.map((provider) => entryOf(provider, snap, ctx.db))
}

export function providerEntry(ctx: SetupCtx, id: string): ProviderConfigEntry {
  return entryOf(requireProvider(id), snapshot(ctx), ctx.db)
}

// ─── What Agents think and draw with ─────────────────────────────────────

export function modelsOverview(ctx: SetupCtx): ModelsResponse {
  const snap = snapshot(ctx)
  const usage = modelUsage(ctx.db)
  const chat: ChatModelEntry[] = []
  for (const provider of PROVIDERS) {
    if (!snap.enabled.has(provider.id)) continue
    const entry = entryOf(provider, snap, ctx.db)
    const facts = new Map(chatCatalog(provider.id).map((model) => [model.id, model]))
    for (const id of entry.models) {
      const value = `${provider.id}:${id}`
      chat.push({
        ...catalogModel(id, facts.get(id)),
        selected: true,
        suggested: entry.suggested.includes(id),
        value,
        provider: provider.id,
        providerName: provider.displayName,
        providerConnect: entry.connect,
        providerState: entry.state,
        usedBy: usage.get(value) ?? { agents: 0, templates: [] },
      })
    }
  }
  return {
    chat,
    images: {
      selected: snap.env.BAZILION_IMAGE_MODEL || 'off',
      routes: IMAGE_ROUTES.map((route) => {
        const needs = imageRouteNeeds(route, snap.env, snap.codex.connected)
        return {
          id: route.id,
          model: route.model,
          provider: route.provider,
          providerName: findProvider(route.provider)?.displayName ?? route.provider,
          billing: route.billing,
          ready: needs === null,
          ...(needs ? { needs } : {}),
        }
      }),
    },
  }
}

function catalogModel(
  id: string,
  facts: CatalogEntry | undefined,
): Omit<CatalogModel, 'selected' | 'suggested'> {
  if (!facts) return { id }
  return {
    id,
    name: facts.name,
    ...(facts.contextWindow > 0 ? { contextWindow: facts.contextWindow } : {}),
    images: facts.images,
    reasoning: facts.reasoning,
    ...(facts.price ? { price: facts.price } : {}),
  }
}

// ─── A provider's models ─────────────────────────────────────────────────

/** `fields` of a request, checked against the provider's own settings. */
function providerOverrides(provider: ProviderDef, fields: unknown): Record<string, string> {
  if (fields === undefined) return {}
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new DomainError(400, 'fields must be an object of setting names and values')
  }
  const overrides: Record<string, string> = {}
  for (const [name, value] of Object.entries(fields)) {
    if (!provider.fields.some((field) => field.envVar === name)) {
      throw new DomainError(400, `${name} is not a setting of ${provider.id}`)
    }
    if (typeof value !== 'string') throw new DomainError(400, `${name} must be a string`)
    overrides[name] = value.trim()
  }
  return overrides
}

/**
 * Every chat model the provider offers: Pi's catalog with its facts, then what the provider lists
 * itself. A local server has only its own list. `fields` are values that are not saved yet.
 */
export async function providerCatalog(
  ctx: SetupCtx,
  id: string,
  fields?: unknown,
  signal?: AbortSignal,
): Promise<ProviderCatalogResponse> {
  const provider = requireProvider(id)
  const env = effectiveEnv(ctx, providerOverrides(provider, fields))
  const limit = AbortSignal.timeout(LIST_TIMEOUT_MS)
  // A hosted provider is asked for its list only once it is in use: looking at a provider that is
  // not connected sends nothing anywhere. A local server is always asked.
  const ask = Boolean(provider.local) || providerStateRepo.listEnabled(ctx.db).has(id)
  const live = ask
    ? await listLiveModels(id, env, signal ? AbortSignal.any([signal, limit]) : limit)
    : undefined
  const listed = (live?.models ?? []).filter((model) => !isImageModel(id, model))
  const selected = providerModelRepo.list(ctx.db, id)
  const catalog = provider.local ? [] : chatCatalog(id)
  const facts = new Map(catalog.map((model) => [model.id, model]))
  // The catalog first, then models only the provider reports, then saved ids neither knows.
  const ids = [...new Set([...facts.keys(), ...listed, ...selected])]
  const dated = datedCopies(ids)
  const suggested = new Set<string>(provider.suggested ?? [])
  // A local server suggests nothing by name: offer what it lists first.
  if (provider.local && selected.length === 0 && listed[0]) suggested.add(listed[0])
  return {
    models: ids.map((model) => ({
      ...catalogModel(model, facts.get(model)),
      ...(dated.has(model) ? { dated: true } : {}),
      selected: selected.includes(model),
      suggested: suggested.has(model),
    })),
    ...(live?.error ? { listError: live.error } : {}),
  }
}

/** Replace the chat models Agents may use from one provider; a changed list is untested. */
export function setProviderModels(
  ctx: SetupCtx,
  id: string,
  models: readonly string[],
): SetProviderModelsResponse {
  requireProvider(id)
  if (models.some((model) => isImageModel(id, model.trim()))) {
    throw new DomainError(400, IMAGE_MODEL_AS_CHAT)
  }
  const saved = replaceCuratedModels(ctx.db, id, [...models])
  const check = readProviderChecks(ctx.db)[id]
  // The test named one model; once that model is gone it proves nothing about the rest.
  if (check && !saved.models.includes(check.model)) writeProviderCheck(ctx.db, id, null)
  ensureSetupSeeded(ctx.db, ctx.paths)
  return saved
}

/** The model servers that answer at their usual (or saved) addresses on this machine. */
export async function discoverLocalProviders(ctx: SetupCtx): Promise<LocalProvidersResponse> {
  const env = effectiveEnv(ctx)
  const servers = await Promise.all(
    PROVIDERS.filter((provider) => provider.local).map(async (provider) => {
      const live = await listLiveModels(provider.id, env, AbortSignal.timeout(DISCOVERY_TIMEOUT_MS))
      return {
        id: provider.id,
        displayName: provider.displayName,
        address: localAddress(provider, env) ?? '',
        found: Boolean(live) && !live?.error,
        models: live?.models ?? [],
      }
    }),
  )
  return { servers }
}

// ─── Testing ─────────────────────────────────────────────────────────────

/** The given models with the cheapest list price first; unpriced ones keep their order, last. */
export function cheapestFirst(providerId: string, models: readonly string[]): string[] {
  const price = new Map(
    listCatalogEntries(providerId).map((model) => [
      model.id,
      model.price ? model.price.input + model.price.output : Number.POSITIVE_INFINITY,
    ]),
  )
  const cost = (model: string) => price.get(model) ?? Number.POSITIVE_INFINITY
  return models
    .map((model, index) => ({ model, index }))
    .sort((a, b) => cost(a.model) - cost(b.model) || a.index - b.index)
    .map(({ model }) => model)
}

/** The name the bundled catalog gives a model, for the record of a test. */
function nameOf(providerId: string, model: string): { modelName?: string } {
  const name = chatCatalog(providerId).find((entry) => entry.id === model)?.name
  return name ? { modelName: name } : {}
}

function hostOf(address: string | undefined): string | undefined {
  if (!address) return undefined
  try {
    return new URL(address).host
  } catch {
    return address
  }
}

type Asked = { ok: true; ms: number } | { ok: false; failure: ProviderFailure }

/** One short real request to `model`, through the runtime a turn uses. */
async function askModel(
  ctx: SetupCtx,
  provider: ProviderDef,
  model: string,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<Asked> {
  const limit = AbortSignal.timeout(TEST_TIMEOUT_MS)
  const started = Date.now()
  const secrets = provider.fields
    .filter((field) => field.kind === 'secret')
    .flatMap((field) => env[field.envVar] ?? [])
  try {
    const apiKey =
      provider.id === 'openai-codex'
        ? await loadOpenAICodexAccessToken(ctx.db, ctx.authToken)
        : undefined
    if (apiKey) secrets.push(apiKey)
    await testProviderModel({
      providerName: provider.id,
      modelId: model,
      env,
      ...(apiKey ? { apiKey } : {}),
      message: TEST_MESSAGE,
      signal: signal ? AbortSignal.any([signal, limit]) : limit,
    })
    return { ok: true, ms: Date.now() - started }
  } catch (error) {
    const name = chatCatalog(provider.id).find((entry) => entry.id === model)?.name ?? model
    return {
      ok: false,
      failure: describeProviderFailure((error as Error).message, {
        provider,
        modelName: name,
        address: hostOf(localAddress(provider, env)),
        timedOut: limit.aborted,
        secrets,
      }),
    }
  }
}

function missingCredentials(provider: ProviderDef): ProviderFailure {
  const name = provider.displayName
  if (provider.id === 'openai-codex') {
    return {
      kind: 'credentials',
      title: 'ChatGPT is not signed in',
      hint: 'Sign in with ChatGPT first, here or with bazilion auth openai login.',
      detail: '',
    }
  }
  const field = provider.fields.find((candidate) => !candidate.advanced)
  return field
    ? {
        kind: 'credentials',
        title: `${name} needs its ${field.label}`,
        hint: 'Fill it in, then connect again.',
        detail: '',
      }
    : {
        kind: 'credentials',
        title: `${name} has no credentials`,
        hint: provider.hint ?? 'Its credentials come from the daemon’s environment.',
        detail: '',
      }
}

function cleanModels(models: unknown): string[] {
  if (!Array.isArray(models) || models.some((model) => typeof model !== 'string')) {
    throw new DomainError(400, 'models must be an array of strings')
  }
  return [...new Set((models as string[]).map((model) => model.trim()).filter(Boolean))]
}

/**
 * Connect a provider in one step: check the credentials are there, ask the cheapest chosen model
 * for a short reply, and only then save the fields and models and switch the provider on. A model
 * the provider refuses for this account is left out and the next one is asked.
 */
export async function connectProvider(
  ctx: SetupCtx,
  id: string,
  request: Partial<ConnectProviderRequest>,
  signal?: AbortSignal,
): Promise<ConnectProviderResponse> {
  const { db, authToken, paths } = ctx
  const provider = requireProvider(id)
  const overrides = providerOverrides(provider, request.fields)
  const env = effectiveEnv(ctx, overrides)
  const codex = getOpenAICodexStatus(db, authToken)
  if (!hasCredentials(provider, env, codex.connected)) {
    return { connected: false, failure: missingCredentials(provider) }
  }

  const saved = providerModelRepo.list(db, id)
  const models =
    request.models === undefined
      ? saved.length > 0
        ? saved
        : [...(provider.suggested ?? [])]
      : cleanModels(request.models)
  if (models.some((model) => isImageModel(id, model))) {
    throw new DomainError(400, IMAGE_MODEL_AS_CHAT)
  }

  let check: ProviderCheck | null = null
  const dropped: { model: string; detail: string }[] = []
  if (request.test !== false && models.length > 0) {
    let refused: ProviderFailure | undefined
    for (const model of cheapestFirst(id, models).slice(0, MAX_TEST_ATTEMPTS)) {
      const asked = await askModel(ctx, provider, model, env, signal)
      if (asked.ok) {
        check = { ok: true, at: Date.now(), model, ...nameOf(id, model), ms: asked.ms }
        break
      }
      if (asked.failure.kind !== 'model') return { connected: false, failure: asked.failure }
      dropped.push({ model, detail: asked.failure.detail })
      refused = asked.failure
    }
    if (!check) return { connected: false, failure: refused as ProviderFailure }
  }

  const kept = models.filter((model) => !dropped.some((entry) => entry.model === model))
  let movedTemplates: SetProviderModelsResponse['movedTemplates'] = []
  db.raw.transaction(() => {
    for (const [name, value] of Object.entries(overrides)) {
      const field = provider.fields.find((candidate) => candidate.envVar === name)
      if (field) writeSetting(db, authToken, field, value)
    }
    movedTemplates = replaceCuratedModels(db, id, kept).movedTemplates
    providerStateRepo.setEnabled(db, id, true)
    writeProviderCheck(db, id, check)
  })()
  ensureSetupSeeded(db, paths)
  return { connected: true, provider: providerEntry(ctx, id), check, dropped, movedTemplates }
}

/** Ask a connected provider's cheapest chosen model again and remember the outcome. */
export async function testProvider(
  ctx: SetupCtx,
  id: string,
  signal?: AbortSignal,
): Promise<TestProviderResponse> {
  const provider = requireProvider(id)
  const env = effectiveEnv(ctx)
  const model = cheapestFirst(id, providerModelRepo.list(ctx.db, id))[0]
  if (!model) throw new DomainError(409, `${provider.displayName} has no chat model to ask`)
  let check: ProviderCheck
  if (!hasCredentials(provider, env, getOpenAICodexStatus(ctx.db, ctx.authToken).connected)) {
    check = { ok: false, at: Date.now(), model, failure: missingCredentials(provider) }
  } else {
    const asked = await askModel(ctx, provider, model, env, signal)
    check = asked.ok
      ? { ok: true, at: Date.now(), model, ...nameOf(id, model), ms: asked.ms }
      : { ok: false, at: Date.now(), model, ...nameOf(id, model), failure: asked.failure }
  }
  writeProviderCheck(ctx.db, id, check)
  return { check, provider: providerEntry(ctx, id) }
}

/** Record the outcome of a free-form `provider:model` test against that provider. */
export function recordProviderTest(
  ctx: SetupCtx,
  providerId: string,
  model: string,
  outcome: { ms: number } | { error: string },
): void {
  const provider = findProvider(providerId)
  if (!provider) return
  if ('ms' in outcome) {
    writeProviderCheck(ctx.db, providerId, {
      ok: true,
      at: Date.now(),
      model,
      ...nameOf(providerId, model),
      ms: outcome.ms,
    })
    return
  }
  const env = effectiveEnv(ctx)
  writeProviderCheck(ctx.db, providerId, {
    ok: false,
    at: Date.now(),
    model,
    ...nameOf(providerId, model),
    failure: describeProviderFailure(outcome.error, {
      provider,
      modelName: chatCatalog(providerId).find((entry) => entry.id === model)?.name ?? model,
      address: hostOf(localAddress(provider, env)),
      secrets: provider.fields
        .filter((field) => field.kind === 'secret')
        .flatMap((field) => env[field.envVar] ?? []),
    }),
  })
}

// ─── Switching off and disconnecting ─────────────────────────────────────

/** Pause or resume a provider. It cannot be switched on without credentials. */
export function setProviderEnabled(ctx: SetupCtx, id: string, enabled: boolean): void {
  const provider = requireProvider(id)
  if (enabled) {
    const snap = snapshot(ctx)
    if (!hasCredentials(provider, snap.env, snap.codex.connected)) {
      throw new DomainError(
        409,
        `${provider.displayName} has no credentials yet: connect it first (bazilion provider connect ${id})`,
      )
    }
  }
  providerStateRepo.setEnabled(ctx.db, id, enabled)
  ensureSetupSeeded(ctx.db, ctx.paths)
}

/**
 * Forget a provider: its stored fields (unless another provider that is switched on reads the
 * same one), its ChatGPT sign-in, its chat models and its test. Agent templates on one of its
 * models move to another available model.
 */
export function disconnectProvider(ctx: SetupCtx, id: string): SetProviderModelsResponse {
  const { db, authToken } = ctx
  const provider = requireProvider(id)
  const enabled = providerStateRepo.listEnabled(db)
  let result: SetProviderModelsResponse = { models: [], movedTemplates: [] }
  db.raw.transaction(() => {
    providerStateRepo.setEnabled(db, id, false)
    for (const field of provider.fields) {
      const shared = providersUsingField(field.envVar).some(
        (other) => other !== id && enabled.has(other),
      )
      if (!shared) writeSetting(db, authToken, field, '')
    }
    if (provider.id === 'openai-codex') clearOpenAICodexCredentials(db, authToken)
    result = replaceCuratedModels(db, id, [])
    writeProviderCheck(db, id, null)
  })()
  return result
}

/** A stored field changed outside a connect: what its providers proved before no longer holds. */
export function forgetChecksFor(db: BazilionDb, envVar: string): void {
  for (const id of providersUsingField(envVar)) writeProviderCheck(db, id, null)
}
