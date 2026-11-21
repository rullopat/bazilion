// /api/config/*: model providers (state, connect, test, disconnect, models), what Agents think
// and draw with, service cards, and per-field config/secret writes.

import type {
  AvailableModelsResponse,
  ConnectProviderRequest,
  ProviderCatalogRequest,
  ProviderConfigResponse,
  ServiceCard,
  ServiceConfigResponse,
  SetProviderEnabledResponse,
  SetProviderModelsRequest,
} from '@bazilion/api-types'
import { imageRoute } from '../core/image-generation-config.ts'
import {
  type BazilionDb,
  findFieldByEnvVar,
  groupAvailableModels,
  mergeSecretsIntoEnv,
  openConfig,
  openSecrets,
  type ServiceDef,
  servicesByCategory,
} from '../core/index.ts'
import { getCtx } from '../lib/ctx.ts'
import {
  connectProvider,
  disconnectProvider,
  discoverLocalProviders,
  forgetChecksFor,
  modelsOverview,
  providerCatalog,
  providerEntries,
  requireProvider,
  setProviderEnabled,
  setProviderModels,
  testProvider,
} from '../lib/provider-setup.ts'
import { fieldStates, readStoredSettings, writeSetting } from '../lib/setting-fields.ts'
import { searchStatus } from '../lib/web-search.ts'
import { hasCredentials } from '../runtime/auth/openai-codex.ts'
import { jsonBody, newRouter } from './http.ts'

export const configRouter = newRouter()

// ─── Providers ───────────────────────────────────────────────────────────

// Every provider with its state. Nothing here asks a provider anything, so the page opens at
// once whatever a local server is doing.
configRouter.get('/providers', (c) =>
  c.json({ providers: providerEntries(getCtx()) } satisfies ProviderConfigResponse),
)

// Model servers answering at their usual addresses on this machine.
configRouter.get('/providers/local', async (c) => c.json(await discoverLocalProviders(getCtx())))

// A provider's chat models: the bundled catalog with its facts, plus the provider's own list.
configRouter.get('/providers/:name/catalog', async (c) =>
  c.json(await providerCatalog(getCtx(), c.req.param('name'), undefined, c.req.raw.signal)),
)

// The same with field values that are not saved yet (an address or key being typed).
configRouter.post('/providers/:name/catalog', async (c) => {
  const body = await jsonBody<ProviderCatalogRequest>(c)
  return c.json(
    await providerCatalog(getCtx(), c.req.param('name'), body?.fields, c.req.raw.signal),
  )
})

// Save, switch on and test in one step; a failed test saves nothing.
configRouter.post('/providers/:name/connect', async (c) => {
  const body = (await jsonBody<ConnectProviderRequest>(c)) ?? {}
  return c.json(await connectProvider(getCtx(), c.req.param('name'), body, c.req.raw.signal))
})

// Ask the provider's cheapest chosen model again; the outcome is remembered.
configRouter.post('/providers/:name/test', async (c) =>
  c.json(await testProvider(getCtx(), c.req.param('name'), c.req.raw.signal)),
)

// Forget the provider: credentials, models, test.
configRouter.delete('/providers/:name', (c) =>
  c.json(disconnectProvider(getCtx(), c.req.param('name'))),
)

// Pause or resume a provider without touching its credentials.
configRouter.put('/providers/:name/enabled', async (c) => {
  const name = c.req.param('name')
  requireProvider(name)
  const enabled = (await jsonBody<{ enabled: unknown }>(c))?.enabled
  if (typeof enabled !== 'boolean') {
    return c.json({ error: 'body must be {"enabled": boolean}' }, 400)
  }
  setProviderEnabled(getCtx(), name, enabled)
  return c.json({ name, enabled } satisfies SetProviderEnabledResponse)
})

// The chat models Agents may use from one provider.
configRouter.put('/providers/:name/models', async (c) => {
  const body = await jsonBody<SetProviderModelsRequest>(c)
  if (!Array.isArray(body?.models)) {
    return c.json({ error: 'models must be an array of strings' }, 400)
  }
  const models = body.models.filter((m): m is string => typeof m === 'string')
  return c.json(setProviderModels(getCtx(), c.req.param('name'), models))
})

// ─── Models by function ──────────────────────────────────────────────────

// What Agents think with (chat models, who uses each) and draw with (image routes).
configRouter.get('/models', (c) => c.json(modelsOverview(getCtx())))

// Chat models grouped by provider: the model menus of Agents and templates.
configRouter.get('/available-models', (c) =>
  c.json({ teams: groupAvailableModels(getCtx().db) } satisfies AvailableModelsResponse),
)

// ─── Services ────────────────────────────────────────────────────────────

// Service cards (web search, the browser, …), and the model functions chosen on the Models page.
configRouter.get('/services', (c) => {
  const { db, authToken } = getCtx()
  const stored = readStoredSettings(db, authToken)
  const env = mergeSecretsIntoEnv(db, authToken)
  const image = imageRoute(env, hasCredentials(db, authToken))
  const card = (svc: ServiceDef): ServiceCard => ({
    ...(svc.id === 'image-generation'
      ? { status: image.ready ? `Ready: ${image.model}.` : image.reason }
      : {}),
    ...(svc.id === 'web-search' ? { status: searchStatus(env) } : {}),
    id: svc.id,
    displayName: svc.displayName,
    ...(svc.hint ? { hint: svc.hint } : {}),
    ...(svc.team ? { team: svc.team } : {}),
    fields: fieldStates(svc.fields, stored),
  })
  return c.json({
    services: servicesByCategory('service').map(card),
    functions: servicesByCategory('function').map(card),
  } satisfies ServiceConfigResponse)
})

// ─── Fields ──────────────────────────────────────────────────────────────

// Write-through for any setting the registry knows.
configRouter.put('/fields/:envVar', async (c) => {
  const envVar = c.req.param('envVar')
  const field = findFieldByEnvVar(envVar)
  if (!field) return c.json({ error: `unknown envVar: ${envVar}` }, 404)

  const body = await jsonBody<{ value: unknown }>(c)
  if (!body || typeof body.value !== 'string') {
    return c.json({ error: 'body must be {"value": "<string>"}' }, 400)
  }
  if (body.value && field.options && !field.options.includes(body.value)) {
    return c.json({ error: `Choose one of: ${field.options.join(', ')}` }, 400)
  }

  const { db, authToken } = getCtx()
  writeSetting(db, authToken, field, body.value)
  forgetChecksFor(db, envVar)
  return c.json(readFieldState(db, authToken, envVar, field.kind))
})

configRouter.delete('/fields/:envVar', (c) => {
  const envVar = c.req.param('envVar')
  const field = findFieldByEnvVar(envVar)
  if (!field) return c.json({ error: `unknown envVar: ${envVar}` }, 404)

  const { db, authToken } = getCtx()
  writeSetting(db, authToken, field, '')
  forgetChecksFor(db, envVar)
  return c.body(null, 204)
})

interface FieldState {
  envVar: string
  kind: 'secret' | 'config'
  set: boolean
  value?: string
  preview?: string
}

function readFieldState(
  db: BazilionDb,
  authToken: string,
  envVar: string,
  kind: 'secret' | 'config',
): FieldState {
  if (kind === 'config') {
    const v = openConfig(db).get(envVar) ?? ''
    return { envVar, kind, set: v.length > 0, value: v }
  }
  const v = openSecrets(db, authToken).get(envVar) ?? ''
  const preview = v.length > 8 ? `${v.slice(0, 6)}…` : '***'
  return { envVar, kind, set: v.length > 0, ...(v.length > 0 ? { preview } : {}) }
}
