// /api/config/*: model providers (state, connect, test, disconnect, models), what Agents think
// and draw with, the tools and their settings, and config/secret writes.

import type {
  ConnectProviderRequest,
  ProviderCatalogRequest,
  ProviderConfigResponse,
  ServiceFieldState,
  SetFieldsRequest,
  SetFieldsResponse,
  SetProviderEnabledResponse,
  SetProviderModelsRequest,
} from '@bazilion/api-types'
import { type BazilionDb, findFieldByEnvVar } from '../core/index.ts'
import type { ServiceField } from '../core/services.ts'
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
import {
  fieldStates,
  normalizeSetting,
  readStoredSettings,
  writeSetting,
} from '../lib/setting-fields.ts'
import { toolsOverview } from '../lib/tools-overview.ts'
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

// What Agents think with (chat models with their names and facts, and who uses each) and draw
// with (image routes). The Models page and the model menus of Agents and templates read this.
configRouter.get('/models', (c) => c.json(modelsOverview(getCtx())))

// ─── Tools ───────────────────────────────────────────────────────────────

// The tools (web search, the browser, commands, …) with what each is doing now, and the model
// functions chosen on the Models page.
configRouter.get('/tools', async (c) => c.json(await toolsOverview(getCtx())))

// ─── Fields ──────────────────────────────────────────────────────────────

function fieldState(db: BazilionDb, authToken: string, field: ServiceField): ServiceFieldState {
  const [state] = fieldStates([field], readStoredSettings(db, authToken))
  return state as ServiceFieldState
}

// Several settings saved together, as one card of the Tools page does: every value is checked
// first, and nothing is stored unless all of them pass. An empty value clears a setting.
configRouter.put('/fields', async (c) => {
  const body = await jsonBody<SetFieldsRequest>(c)
  const values = body?.values
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return c.json({ error: 'body must be {"values": {"NAME": "value", …}}' }, 400)
  }
  const accepted: { field: ServiceField; value: string }[] = []
  const errors: Record<string, string> = {}
  for (const [envVar, raw] of Object.entries(values)) {
    const field = findFieldByEnvVar(envVar)
    if (!field) errors[envVar] = `unknown setting: ${envVar}`
    else if (typeof raw !== 'string') errors[envVar] = `${envVar} must be text`
    else {
      const checked = normalizeSetting(field, raw)
      if ('error' in checked) errors[envVar] = checked.error
      else accepted.push({ field, value: checked.value })
    }
  }
  const [firstError] = Object.values(errors)
  if (firstError) return c.json({ error: firstError, errors }, 400)

  const { db, authToken } = getCtx()
  db.raw.transaction(() => {
    for (const { field, value } of accepted) {
      writeSetting(db, authToken, field, value)
      forgetChecksFor(db, field.envVar)
    }
  })()
  return c.json({
    fields: fieldStates(
      accepted.map(({ field }) => field),
      readStoredSettings(db, authToken),
    ),
  } satisfies SetFieldsResponse)
})

// One setting, as `bazilion config set` writes it.
configRouter.put('/fields/:envVar', async (c) => {
  const envVar = c.req.param('envVar')
  const field = findFieldByEnvVar(envVar)
  if (!field) return c.json({ error: `unknown envVar: ${envVar}` }, 404)

  const body = await jsonBody<{ value: unknown }>(c)
  if (!body || typeof body.value !== 'string') {
    return c.json({ error: 'body must be {"value": "<string>"}' }, 400)
  }
  const checked = normalizeSetting(field, body.value)
  if ('error' in checked) return c.json({ error: checked.error }, 400)

  const { db, authToken } = getCtx()
  writeSetting(db, authToken, field, checked.value)
  forgetChecksFor(db, envVar)
  return c.json(fieldState(db, authToken, field))
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
