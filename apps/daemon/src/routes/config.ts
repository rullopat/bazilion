// /api/config/* — provider matrix, services, per-provider enabled toggle and
// curated models, and per-field config/secret writes.

import type {
  ProviderConfigEntry,
  ProviderConfigResponse,
  ServiceCard,
  ServiceConfigResponse,
  ServiceFieldState,
  SetProviderModelsRequest,
} from '@bazilion/api-types'
import { Hono } from 'hono'
import {
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
import { getCtx } from '../lib/ctx.ts'
import {
  listAllProviders,
  listCatalogModels,
  listCatalogModelsSync,
  loadProviderConfigFromEnv,
} from '../runtime/index.ts'

export const configRouter = new Hono()

// /api/config/providers
configRouter.get('/providers', async (c) => {
  const { db, paths, authToken } = getCtx()
  const env = mergeSecretsIntoEnv(db, authToken)
  const registryProviders = listAllProviders(loadProviderConfigFromEnv(env, { db, authToken }))
  const registryByName = new Map(registryProviders.map((p) => [p.name, p]))

  const configValues = readAll(() => openConfig(db).getAll())
  const secretValues = readAll(() => openSecrets(db, authToken).getAll())

  const providerServices = servicesByCategory('provider')
  const enabledSet = providerStateRepo.listEnabled(db)

  const entries = await Promise.all(
    providerServices.map(async (svc): Promise<ProviderConfigEntry> => {
      const meta = registryByName.get(svc.id)
      const enabled = enabledSet.has(svc.id)
      const envHint = meta?.envHint ?? ''
      const ac = new AbortController()
      const t = setTimeout(() => ac.abort(), 5_000)
      try {
        const { catalog, live } = enabled
          ? await listCatalogModels(svc.id, env, ac.signal)
          : { catalog: listCatalogModelsSync(svc.id), live: undefined }
        return {
          id: svc.id,
          displayName: svc.displayName,
          ...(svc.hint ? { hint: svc.hint } : {}),
          enabled,
          envHint,
          fields: resolveFieldStates(svc, configValues, secretValues),
          catalog,
          ...(live ? { live } : {}),
          curated: providerModelRepo.list(db, svc.id),
        }
      } finally {
        clearTimeout(t)
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

  const services: ServiceCard[] = servicesByCategory('service').map((svc) => ({
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
  if (!knownProviderIds().has(name)) return c.json({ error: `unknown provider: ${name}` }, 404)

  const body = (await c.req.json().catch(() => null)) as { enabled?: unknown } | null
  if (!body || (typeof body.enabled !== 'boolean' && typeof body.enabled !== 'string')) {
    return c.json({ error: 'body must be {"enabled": boolean}' }, 400)
  }
  const enabled =
    typeof body.enabled === 'boolean' ? body.enabled : body.enabled.toLowerCase() === 'true'

  const { db, paths } = getCtx()
  providerStateRepo.setEnabled(db, name, enabled)
  ensureSetupSeeded(db, paths)
  return c.json({ name, enabled })
})

// /api/config/providers/:name/models — curated model list.
configRouter.get('/providers/:name/models', (c) => {
  const name = c.req.param('name')
  if (!knownProviderRegistryNames().has(name))
    return c.json({ error: `unknown provider: ${name}` }, 404)
  const { db } = getCtx()
  return c.json({ models: providerModelRepo.list(db, name) })
})

configRouter.put('/providers/:name/models', async (c) => {
  const name = c.req.param('name')
  if (!knownProviderRegistryNames().has(name))
    return c.json({ error: `unknown provider: ${name}` }, 404)
  const body = (await c.req.json().catch(() => null)) as Partial<SetProviderModelsRequest> | null
  if (!body) return c.json({ error: 'invalid JSON body' }, 400)

  // Accept textarea-style newline-separated input from web forms in addition
  // to the CLI's array shape.
  let models: string[] = []
  if (Array.isArray(body.models)) {
    models = body.models.filter((m): m is string => typeof m === 'string')
  } else if (typeof (body as Record<string, unknown>).models === 'string') {
    models = ((body as Record<string, unknown>).models as string).split(/\r?\n/)
  } else {
    return c.json(
      { error: 'models must be an array of strings or a newline-separated string' },
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
  const found = findFieldByEnvVar(envVar)
  if (!found) return c.json({ error: `unknown envVar: ${envVar}` }, 404)

  const body = (await c.req.json().catch(() => null)) as { value?: unknown } | null
  if (!body || typeof body.value !== 'string') {
    return c.json({ error: 'body must be {"value": "<string>"}' }, 400)
  }

  const { db, authToken } = getCtx()
  if (found.field.kind === 'config') {
    const store = openConfig(db)
    if (body.value === '') store.remove(envVar)
    else store.set(envVar, body.value)
  } else {
    const store = openSecrets(db, authToken)
    if (body.value === '') store.remove(envVar)
    else store.set(envVar, body.value)
  }

  return c.json(readFieldState(db, authToken, envVar, found.field.kind))
})

// /api/config/available-models — provider-grouped curated models. Drives
// the model dropdowns on the profile + agent spawn pages.
configRouter.get('/available-models', (c) => {
  const { db } = getCtx()
  return c.json({ teams: groupAvailableModels(db) })
})

configRouter.delete('/fields/:envVar', (c) => {
  const envVar = c.req.param('envVar')
  const found = findFieldByEnvVar(envVar)
  if (!found) return c.json({ error: `unknown envVar: ${envVar}` }, 404)

  const { db, authToken } = getCtx()
  if (found.field.kind === 'config') {
    openConfig(db).remove(envVar)
  } else {
    openSecrets(db, authToken).remove(envVar)
  }
  return c.body(null, 204)
})

// ─── helpers ─────────────────────────────────────────────────────────────

function mask(value: string): string {
  if (value.length === 0) return ''
  return value.length > 8 ? `${value.slice(0, 6)}…` : '***'
}

function resolveFieldStates(
  service: ServiceDef,
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
  db: import('../core/index.ts').BazilionDb,
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

function knownProviderIds(): Set<string> {
  return new Set(servicesByCategory('provider').map((s) => s.id))
}

function knownProviderRegistryNames(): Set<string> {
  const { db, authToken } = getCtx()
  return new Set(
    listAllProviders(loadProviderConfigFromEnv(process.env, { db, authToken })).map((p) => p.name),
  )
}
