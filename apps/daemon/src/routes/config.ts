// /api/config/* — provider matrix, services, per-provider enabled toggle and
// curated models, and per-field config/secret writes.

import type {
  AvailableModelsResponse,
  ProviderConfigEntry,
  ProviderConfigResponse,
  ServiceCard,
  ServiceConfigResponse,
  ServiceFieldState,
  SetProviderModelsRequest,
} from '@bazilion/api-types'
import { IMAGE_MODEL_CHOICES, imageRoute } from '../core/image-generation-config.ts'
import {
  type BazilionDb,
  ensureSetupSeeded,
  findFieldByEnvVar,
  groupAvailableModels,
  mergeSecretsIntoEnv,
  openConfig,
  openSecrets,
  providerModelRepo,
  providerStateRepo,
  type ServiceDef,
  servicesByCategory,
} from '../core/index.ts'
import { findProvider, PROVIDERS } from '../core/providers.ts'
import { getCtx } from '../lib/ctx.ts'
import { searchStatus } from '../lib/web-search.ts'
import { hasCredentials } from '../runtime/auth/openai-codex.ts'
import { listCatalogModels, listCatalogModelsSync } from '../runtime/index.ts'
import { jsonBody, newRouter } from './http.ts'

export const configRouter = newRouter()

// /api/config/providers
configRouter.get('/providers', async (c) => {
  const { db, authToken } = getCtx()
  const env = mergeSecretsIntoEnv(db, authToken)
  const configValues = readAll(() => openConfig(db).getAll())
  const secretValues = readAll(() => openSecrets(db, authToken).getAll())

  const enabledSet = providerStateRepo.listEnabled(db)

  const entries = await Promise.all(
    PROVIDERS.map(async (provider): Promise<ProviderConfigEntry> => {
      const enabled = enabledSet.has(provider.id)
      // Live model listings are fetched only for enabled providers, and briefly.
      const { catalog, live } = enabled
        ? await listCatalogModels(provider.id, env, AbortSignal.timeout(5_000))
        : { catalog: listCatalogModelsSync(provider.id), live: undefined }
      return {
        id: provider.id,
        displayName: provider.displayName,
        ...(provider.hint ? { hint: provider.hint } : {}),
        enabled,
        fields: resolveFieldStates(provider, configValues, secretValues),
        catalog: catalog.filter((model) => !isImageChoice(provider.id, model)),
        ...(live
          ? {
              live: {
                ...live,
                models: live.models.filter((model) => !isImageChoice(provider.id, model)),
              },
            }
          : {}),
        curated: providerModelRepo.list(db, provider.id),
      }
    }),
  )

  const body: ProviderConfigResponse = { providers: entries }
  return c.json(body)
})

// /api/config/services — non-provider service cards (e.g. SearXNG, Brave).
configRouter.get('/services', (c) => {
  const { db, authToken } = getCtx()
  const configValues = readAll(() => openConfig(db).getAll())
  const secretValues = readAll(() => openSecrets(db, authToken).getAll())

  const env = mergeSecretsIntoEnv(db, authToken)
  const image = imageRoute(env, hasCredentials(db, authToken))
  const services: ServiceCard[] = servicesByCategory('service').map((svc) => ({
    ...(svc.id === 'image-generation'
      ? { status: image.ready ? `Ready: ${image.model}.` : image.reason }
      : {}),
    ...(svc.id === 'web-search' ? { status: searchStatus(env) } : {}),
    id: svc.id,
    displayName: svc.displayName,
    ...(svc.hint ? { hint: svc.hint } : {}),
    ...(svc.team ? { team: svc.team } : {}),
    fields: resolveFieldStates(svc, configValues, secretValues),
  }))

  const body: ServiceConfigResponse = { services }
  return c.json(body)
})

// /api/config/providers/:name/enabled — flip the admin switch.
configRouter.put('/providers/:name/enabled', async (c) => {
  const name = c.req.param('name')
  if (!findProvider(name)) return c.json({ error: `unknown provider: ${name}` }, 404)

  const enabled = (await jsonBody<{ enabled: unknown }>(c))?.enabled
  if (typeof enabled !== 'boolean') {
    return c.json({ error: 'body must be {"enabled": boolean}' }, 400)
  }

  const { db, paths } = getCtx()
  providerStateRepo.setEnabled(db, name, enabled)
  ensureSetupSeeded(db, paths)
  return c.json({ name, enabled })
})

// /api/config/providers/:name/models — curated model list.
configRouter.get('/providers/:name/models', (c) => {
  const name = c.req.param('name')
  if (!findProvider(name)) return c.json({ error: `unknown provider: ${name}` }, 404)
  const { db } = getCtx()
  return c.json({ models: providerModelRepo.list(db, name) })
})

configRouter.put('/providers/:name/models', async (c) => {
  const name = c.req.param('name')
  if (!findProvider(name)) return c.json({ error: `unknown provider: ${name}` }, 404)
  const body = await jsonBody<SetProviderModelsRequest>(c)
  if (!Array.isArray(body?.models)) {
    return c.json({ error: 'models must be an array of strings' }, 400)
  }
  const models = body.models.filter((m): m is string => typeof m === 'string')

  if (models.some((model) => isImageChoice(name, model.trim()))) {
    return c.json(
      { error: 'Configure image models in Services → Image generation, not as chat models.' },
      400,
    )
  }
  const { db, paths } = getCtx()
  providerModelRepo.replace(db, name, models)
  ensureSetupSeeded(db, paths)
  return c.json({ models: providerModelRepo.list(db, name) })
})

// /api/config/fields/:envVar — write-through for any envVar the registry knows.
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
  if (field.kind === 'config') {
    const store = openConfig(db)
    if (body.value === '') store.remove(envVar)
    else store.set(envVar, body.value)
  } else {
    const store = openSecrets(db, authToken)
    if (body.value === '') store.remove(envVar)
    else store.set(envVar, body.value)
  }

  return c.json(readFieldState(db, authToken, envVar, field.kind))
})

// /api/config/available-models — provider-grouped curated models. Drives
// the model dropdowns on the profile + agent spawn pages.
configRouter.get('/available-models', (c) =>
  c.json({ teams: groupAvailableModels(getCtx().db) } satisfies AvailableModelsResponse),
)

configRouter.delete('/fields/:envVar', (c) => {
  const envVar = c.req.param('envVar')
  const field = findFieldByEnvVar(envVar)
  if (!field) return c.json({ error: `unknown envVar: ${envVar}` }, 404)

  const { db, authToken } = getCtx()
  if (field.kind === 'config') {
    openConfig(db).remove(envVar)
  } else {
    openSecrets(db, authToken).remove(envVar)
  }
  return c.body(null, 204)
})

// ─── helpers ─────────────────────────────────────────────────────────────

/** Image models are chosen under Services → Image generation, never as chat models. */
function isImageChoice(provider: string, model: string): boolean {
  return (IMAGE_MODEL_CHOICES as readonly string[]).includes(`${provider}:${model}`)
}

function mask(value: string): string {
  if (value.length === 0) return ''
  return value.length > 8 ? `${value.slice(0, 6)}…` : '***'
}

function resolveFieldStates(
  service: Pick<ServiceDef, 'fields'>,
  configValues: Record<string, string>,
  secretValues: Record<string, string>,
): ServiceFieldState[] {
  return service.fields.map((f) => {
    const val = (f.kind === 'config' ? configValues[f.envVar] : secretValues[f.envVar]) ?? ''
    const state: ServiceFieldState = {
      envVar: f.envVar,
      kind: f.kind,
      label: f.label,
      set: val.length > 0,
      ...(f.placeholder ? { placeholder: f.placeholder } : {}),
      ...(f.description ? { description: f.description } : {}),
      ...(f.options ? { options: f.options } : {}),
      ...(f.optionLabels ? { optionLabels: f.optionLabels } : {}),
    }
    if (f.kind === 'config') {
      state.value = val
    } else if (val.length > 0) {
      state.preview = mask(val)
    }
    return state
  })
}

function readAll(read: () => Record<string, string>): Record<string, string> {
  try {
    return read()
  } catch {
    return {}
  }
}

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
  return { envVar, kind, set: v.length > 0, ...(v.length > 0 ? { preview: mask(v) } : {}) }
}
