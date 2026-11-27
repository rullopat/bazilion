// The Tools page and `bazilion config list`: each tool with its settings, what it is doing now
// and what a choice would meet on this installation.

import type {
  ServiceCard,
  ServiceFieldState,
  ServiceState,
  SettingOption,
  ToolsResponse,
} from '@bazilion/api-types'
import { imageRoute } from '../core/image-generation-config.ts'
import {
  type BazilionDb,
  mergeSecretsIntoEnv,
  providerModelRepo,
  providerStateRepo,
  type ServiceDef,
  servicesByCategory,
} from '../core/index.ts'
import { hasCredentials as codexSignedIn } from '../runtime/auth/openai-codex.ts'
import { checkDockerImage } from '../runtime/shell/docker.ts'
import { resolveShellSecurityConfig } from '../runtime/shell/security.ts'
import { isBrowserEnabled, resolveBrowserConfig } from './browser/config.ts'
import { fieldStates, readStoredSettings } from './setting-fields.ts'

/** Docker is asked on every load of the page: it gets a moment, not the page. */
const DOCKER_WAIT_MS = 3_000

type Note = NonNullable<SettingOption['note']>
interface Described {
  state: ServiceState
  note?: string
  /** Notes for the options of a choice, by setting name and option value. */
  options?: Record<string, Record<string, Note>>
}

const on = (label: string): ServiceState => ({ label, tone: 'on' })
const warning = (label: string): ServiceState => ({ label, tone: 'warning' })

/** Whether a model of OpenAI or of a ChatGPT plan is in Chat: those bring their own search. */
function hasSearchingModel(db: BazilionDb, env: NodeJS.ProcessEnv, authToken: string): boolean {
  const enabled = providerStateRepo.listEnabled(db)
  const usable = (id: string, ready: boolean) =>
    ready && enabled.has(id) && providerModelRepo.list(db, id).length > 0
  return (
    usable('openai', Boolean(env.OPENAI_API_KEY?.trim())) ||
    usable('openai-codex', codexSignedIn(db, authToken))
  )
}

function describeSearch(db: BazilionDb, env: NodeJS.ProcessEnv, authToken: string): Described {
  const brave = Boolean(env.BRAVE_API_KEY?.trim())
  const searxng = Boolean(env.SEARXNG_URL?.trim())
  const own = hasSearchingModel(db, env, authToken)
  const ownSearch: Described = {
    state: own ? on('Using the model’s own search') : warning('Nothing to search with'),
  }
  const automatic = brave
    ? 'Now: Brave.'
    : searxng
      ? 'Now: SearXNG.'
      : own
        ? 'Now: the model’s own search, for Agents on OpenAI or ChatGPT models.'
        : 'Now: nothing. Only OpenAI and ChatGPT models search by themselves, and none is in Chat: save a Brave key or a SearXNG address.'
  const options: Described['options'] = {
    BAZILION_WEB_SEARCH_ROUTE: {
      auto: { text: automatic, tone: brave || searxng || own ? 'ok' : 'warning' },
      ...(brave ? {} : { brave: { text: 'No Brave API key is saved yet.', tone: 'warning' } }),
      ...(searxng
        ? {}
        : { searxng: { text: 'No SearXNG address is saved yet.', tone: 'warning' } }),
      ...(own
        ? {}
        : {
            native: {
              text: 'No OpenAI or ChatGPT model is in Chat, so no Agent can search.',
              tone: 'warning',
            },
          }),
    },
  }
  const route = env.BAZILION_WEB_SEARCH_ROUTE?.trim() || 'auto'
  const described = ((): Described => {
    switch (route) {
      case 'off':
        return { state: { label: 'Off', tone: 'off' } }
      case 'brave':
        return brave ? { state: on('Using Brave') } : { state: warning('Needs a Brave key') }
      case 'searxng':
        return searxng ? { state: on('Using SearXNG') } : { state: warning('Needs an address') }
      case 'native':
        return ownSearch
      case 'auto':
        return brave
          ? { state: on('Using Brave') }
          : searxng
            ? { state: on('Using SearXNG') }
            : ownSearch
      default:
        return {
          state: warning('Not usable'),
          note: `The stored choice "${route}" is not one of the search backends.`,
        }
    }
  })()
  return { ...described, options }
}

/** Docker's own error, as what is wrong and what to do. */
function dockerProblem(error: string, image: string): string {
  if (/not installed/i.test(error)) return 'Docker is not installed on this computer.'
  if (
    /cannot connect to the docker daemon|docker daemon running|did not (answer|finish)/i.test(error)
  ) {
    return 'Docker is installed but not running. Start it, then open this page again.'
  }
  if (/no such image/i.test(error)) {
    return `Docker is running but does not have the image ${image}. Bazilion never pulls one: run docker pull ${image}`
  }
  return `Docker could not be used: ${error}`
}

async function describeCommands(env: NodeJS.ProcessEnv): Promise<Described> {
  let config: ReturnType<typeof resolveShellSecurityConfig>
  try {
    config = resolveShellSecurityConfig(env)
  } catch (error) {
    return {
      state: warning('Not usable'),
      note: `A stored setting cannot be used, so Agents cannot run commands: ${error instanceof Error ? error.message : String(error)}. Save this card to replace it.`,
    }
  }
  const image = config.sandboxImage
  const docker = await Promise.race([
    checkDockerImage(image),
    new Promise<{ ok: false; error: string }>((resolve) =>
      setTimeout(
        () => resolve({ ok: false, error: 'Docker did not answer in time' }),
        DOCKER_WAIT_MS,
      ),
    ),
  ])
  const dockerNote: Note = docker.ok
    ? { text: `Docker is running and has the image ${image}.`, tone: 'ok' }
    : { text: dockerProblem(docker.error, image), tone: 'warning' }
  const asks =
    config.approvalMode === 'dangerous'
      ? ', asks first'
      : config.approvalMode === 'review'
        ? ', reviewed first'
        : ''
  const state =
    config.sandboxMode !== 'docker'
      ? on(`Runs on this computer${asks}`)
      : docker.ok
        ? on(`Runs in Docker${asks}`)
        : warning('Docker is not ready')
  return {
    state,
    ...(config.sandboxMode === 'docker' && !docker.ok
      ? { note: 'Agents cannot run commands until this is put right.' }
      : {}),
    options: { BAZILION_BASH_SANDBOX: { docker: dockerNote } },
  }
}

async function describe(
  def: ServiceDef,
  db: BazilionDb,
  env: NodeJS.ProcessEnv,
  authToken: string,
): Promise<Described | undefined> {
  switch (def.id) {
    case 'web-search':
      return describeSearch(db, env, authToken)
    case 'web-pages':
      return {
        state: on(
          env.FIRECRAWL_API_KEY?.trim() ? 'Built-in reader, then Firecrawl' : 'Built-in reader',
        ),
      }
    case 'browser':
      if (!isBrowserEnabled(env)) return { state: { label: 'Off', tone: 'off' } }
      return {
        state: on(
          resolveBrowserConfig(env).attach ? 'On: your running Chrome' : 'On: a browser per Agent',
        ),
      }
    case 'commands':
      return describeCommands(env)
    default:
      return undefined
  }
}

function withNotes(
  fields: ServiceFieldState[],
  notes: Described['options'] = {},
): ServiceFieldState[] {
  return fields.map((field) => {
    const forField = notes[field.envVar]
    if (!forField || field.input.type !== 'choice') return field
    return {
      ...field,
      input: {
        ...field.input,
        options: field.input.options.map((option) =>
          forField[option.value] ? { ...option, note: forField[option.value] } : option,
        ),
      },
    }
  })
}

/** Every tool with its settings and state, and the model functions `config list` also prints. */
export async function toolsOverview(ctx: {
  db: BazilionDb
  authToken: string
}): Promise<ToolsResponse> {
  const { db, authToken } = ctx
  const stored = readStoredSettings(db, authToken)
  // What turns run with: the stores under the daemon's own environment.
  const env = mergeSecretsIntoEnv(db, authToken)
  const base = (def: ServiceDef): ServiceCard => ({
    id: def.id,
    displayName: def.displayName,
    ...(def.hint ? { hint: def.hint } : {}),
    ...(def.footnote ? { footnote: def.footnote } : {}),
    fields: fieldStates(def.fields, stored),
  })
  const tools = await Promise.all(
    servicesByCategory('tool').map(async (def): Promise<ServiceCard> => {
      const card = base(def)
      const described = await describe(def, db, env, authToken)
      if (!described) return card
      return {
        ...card,
        state: described.state,
        ...(described.note ? { note: described.note } : {}),
        fields: withNotes(card.fields, described.options),
      }
    }),
  )
  const image = imageRoute(env, codexSignedIn(db, authToken))
  const functions = servicesByCategory('function').map((def): ServiceCard => {
    const card = base(def)
    return def.id === 'image-generation'
      ? { ...card, note: image.ready ? `Ready: ${image.model}.` : image.reason }
      : card
  })
  return { tools, functions }
}
