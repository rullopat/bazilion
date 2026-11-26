import type {
  ConnectProviderRequest,
  ConnectProviderResponse,
  ModelsResponse,
  ModelWindow,
  ProviderCatalogResponse,
  ProviderCheck,
  ProviderConfigEntry,
  ProviderConfigResponse,
  ProviderFailure,
  ProviderTestRequest,
  ProviderTestResponse,
  SetModelWindowRequest,
  SetModelWindowResponse,
  SetProviderEnabledResponse,
  SetProviderModelsRequest,
  SetProviderModelsResponse,
  TestProviderResponse,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { type BazilionClient, createClient } from '../client.ts'
import { apiPath, askSecret, confirm, positional, printRows } from '../command-helpers.ts'
import { collectFlagValues } from '../repeatable-args.ts'

const providerArg = positional('Provider id (e.g. anthropic)')

const STATE: Record<ProviderConfigEntry['state'], string> = {
  working: 'working',
  failing: 'failing',
  untested: 'not tested',
  incomplete: 'needs credentials',
  off: 'off',
}

async function loadProvider(client: BazilionClient, id: string): Promise<ProviderConfigEntry> {
  const { providers } = await client.get<ProviderConfigResponse>('/api/config/providers')
  const provider = providers.find((entry) => entry.id === id)
  if (!provider) throw new Error(`unknown provider: ${id} (see: bazilion provider list --all)`)
  return provider
}

function checkLine(check: ProviderCheck): string {
  const when = new Date(check.at).toISOString().replace(/\.\d+Z$/, 'Z')
  return check.ok
    ? `${check.model} answered in ${((check.ms ?? 0) / 1000).toFixed(1)} s (${when})`
    : `${check.failure?.title ?? 'failed'} (${when})`
}

function printFailure(failure: ProviderFailure): void {
  console.error(failure.title)
  console.error(failure.hint)
  if (failure.detail) console.error(`details: ${failure.detail}`)
}

const listCmd = defineCommand({
  meta: {
    name: 'list',
    description: 'List the providers in use with their state; --all lists every provider',
  },
  args: {
    all: { type: 'boolean', description: 'Also list providers that are not set up' },
    enabled: { type: 'boolean', description: 'Show only providers that are switched on' },
  },
  async run({ args }) {
    const { providers } = await createClient().get<ProviderConfigResponse>('/api/config/providers')
    printRows(
      providers
        .filter((p) => (args.enabled ? p.enabled : args.all || p.listed))
        .map((p) => [
          p.id,
          p.listed ? STATE[p.state] : 'not set up',
          p.models.length === 1 ? '1 model' : `${p.models.length} models`,
          p.check ? checkLine(p.check) : '',
        ]),
      args.all
        ? '(no providers to show)'
        : '(no provider is set up: bazilion provider connect <id>, or list them all with --all)',
    )
  },
})

const connectCmd = defineCommand({
  meta: {
    name: 'connect',
    description:
      'Connect a provider in one step: save its key or address, choose models, test, switch on',
  },
  args: {
    name: providerArg,
    key: {
      type: 'string',
      description: 'API key or access token (asked for, without echo, when left out)',
    },
    url: { type: 'string', description: 'Address of a local model server' },
    set: {
      type: 'string',
      description: 'Another setting of the provider as NAME=value (repeatable)',
    },
    models: {
      type: 'string',
      description: 'Comma-separated chat models (default: the suggested ones)',
    },
    test: {
      type: 'boolean',
      default: true,
      description: 'Ask a model for a short reply before saving anything (--no-test skips it)',
    },
  },
  async run({ args, rawArgs }) {
    const client = createClient()
    const provider = await loadProvider(client, args.name)
    const fields: Record<string, string> = {}
    for (const pair of collectFlagValues(rawArgs, 'set')) {
      const at = pair.indexOf('=')
      if (at <= 0) throw new Error(`--set takes NAME=value, got "${pair}"`)
      fields[pair.slice(0, at)] = pair.slice(at + 1)
    }
    const main = provider.fields.filter((field) => !field.advanced)
    const secret = main.find((field) => field.kind === 'secret')
    const address = main.find((field) => field.kind === 'config')
    if (args.url) {
      if (provider.connect !== 'local' || !address) {
        throw new Error(`--url is for local model servers; ${provider.id} takes --key or --set`)
      }
      fields[address.envVar] = args.url
    }
    if (args.key) {
      const target = secret ?? provider.fields.find((field) => field.kind === 'secret')
      if (!target) throw new Error(`${provider.id} takes no key`)
      fields[target.envVar] = args.key
    } else if (secret && !provider.configured && !(secret.envVar in fields)) {
      const typed = await askSecret(`${provider.displayName} ${secret.label}: `)
      if (!typed) throw new Error('no key given')
      fields[secret.envVar] = typed
    }

    const models = args.models
      ?.split(',')
      .map((model) => model.trim())
      .filter(Boolean)
    if (!models && provider.models.length === 0 && provider.suggested.length === 0) {
      if (provider.connect !== 'local') {
        throw new Error(
          `choose chat models with --models (see: bazilion provider models ${provider.id})`,
        )
      }
    }
    // A local server suggests what it has loaded: ask it, with the address being connected.
    let chosen = models
    if (!chosen && provider.connect === 'local' && provider.models.length === 0) {
      const catalog = await client.post<ProviderCatalogResponse>(
        apiPath('config', 'providers', provider.id, 'catalog'),
        { fields },
      )
      chosen = catalog.models.filter((model) => model.suggested).map((model) => model.id)
    }

    const body: ConnectProviderRequest = {
      ...(Object.keys(fields).length > 0 ? { fields } : {}),
      ...(chosen ? { models: chosen } : {}),
      ...(args.test ? {} : { test: false }),
    }
    const result = await client.post<ConnectProviderResponse>(
      apiPath('config', 'providers', provider.id, 'connect'),
      body,
    )
    if (!result.connected) {
      printFailure(result.failure)
      console.error('Nothing was saved.')
      process.exitCode = 1
      return
    }
    console.log(`${result.provider.id}: connected`)
    if (result.check) console.log(`  ${checkLine(result.check)}`)
    else console.log('  not tested')
    console.log(`  models: ${result.provider.models.join(', ') || '(none)'}`)
    for (const dropped of result.dropped) console.log(`  left out: ${dropped.model}`)
    for (const t of result.movedTemplates) console.log(`  template ${t.id} now uses ${t.model}`)
  },
})

const disconnectCmd = defineCommand({
  meta: {
    name: 'disconnect',
    description: 'Forget a provider: its stored key or sign-in, its chat models and its test',
  },
  args: {
    name: providerArg,
    yes: { type: 'boolean', description: 'Do not ask for confirmation' },
  },
  async run({ args }) {
    const client = createClient()
    const provider = await loadProvider(client, args.name)
    if (
      !args.yes &&
      !(await confirm(`Disconnect ${provider.displayName} and remove its stored credentials?`))
    ) {
      console.log('cancelled')
      return
    }
    const result = await client.del<SetProviderModelsResponse>(
      apiPath('config', 'providers', provider.id),
    )
    console.log(`${provider.id}: disconnected`)
    for (const t of result.movedTemplates) console.log(`template ${t.id} now uses ${t.model}`)
  },
})

const modelsCmd = defineCommand({
  meta: {
    name: 'models',
    description: 'Show a provider’s chat models: the ones Agents may use, and what it offers',
  },
  args: { name: providerArg },
  async run({ args }) {
    const client = createClient()
    const p = await loadProvider(client, args.name)
    const catalog = await client.get<ProviderCatalogResponse>(
      apiPath('config', 'providers', p.id, 'catalog'),
    )
    console.log(`# ${p.id} (${p.listed ? STATE[p.state] : 'not set up'})`)
    if (p.hint) console.log(`  ${p.hint}`)
    for (const field of p.fields) console.log(`  ${field.envVar}: ${field.set ? 'set' : 'unset'}`)
    if (!p.enabled) console.log(`  (connect with \`bazilion provider connect ${p.id}\`)`)

    console.log('\n## in use')
    if (p.models.length === 0) console.log('  (none: `provider connect` or `provider models-set`)')
    else {
      const { chat } = await client.get<ModelsResponse>('/api/config/models')
      const windows = new Map(chat.map((entry) => [entry.value, entry.window]))
      printRows(
        p.models.map((m) => {
          const window = windows.get(`${p.id}:${m}`)
          return [`  ${m}`, window ? `context: ${windowText(window)}` : '']
        }),
        '',
      )
    }

    console.log('\n## offered')
    if (catalog.listError) console.log(`  (the provider's own list failed: ${catalog.listError})`)
    printRows(
      catalog.models.map((model) => [
        `  ${model.id}`,
        model.name ?? '',
        model.contextWindow ? `${Math.round(model.contextWindow / 1000)}K` : '',
        model.price ? `$${model.price.input} in, $${model.price.output} out per 1M` : '',
        model.suggested ? 'suggested' : '',
      ]),
      '  (nothing listed)',
    )
  },
})

const modelsSetCmd = defineCommand({
  meta: {
    name: 'models-set',
    description: 'Replace the chat models Agents may use from a provider (comma-separated)',
  },
  args: {
    name: providerArg,
    models: positional('Comma-separated model list (empty string clears the list)'),
  },
  async run({ args }) {
    const models = args.models
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const body: SetProviderModelsRequest = { models }
    const saved = await createClient().put<SetProviderModelsResponse>(
      apiPath('config', 'providers', args.name, 'models'),
      body,
    )
    console.log(`saved ${saved.models.length} model(s) for ${args.name}`)
    for (const m of saved.models) console.log(`  ${m}`)
    for (const t of saved.movedTemplates) console.log(`template ${t.id} now uses ${t.model}`)
  },
})

/** A chat model's window and what says it. */
export function windowText(window: ModelWindow): string {
  if (window.tokens === null)
    return 'not known, so turns on it are refused (set it with `provider window`)'
  const from =
    window.source === 'catalog'
      ? "Pi's catalog"
      : window.source === 'server'
        ? 'the server'
        : 'set by you'
  const fallback =
    window.source === 'server' && window.set
      ? `; ${window.set.toLocaleString('en-US')} set for when it does not say`
      : ''
  return `${window.tokens.toLocaleString('en-US')} tokens (${from})${fallback}`
}

const windowCmd = defineCommand({
  meta: {
    name: 'window',
    description:
      "Show or set a chat model's context window, for one whose window neither Pi's catalog nor its server says",
  },
  args: {
    model: positional('A model string such as ollama:qwen3'),
    tokens: {
      type: 'positional',
      required: false,
      description: 'The window in tokens, as the model was loaded with; leave out to show it',
    },
    clear: { type: 'boolean', description: 'Forget the window set by hand' },
  },
  async run({ args }) {
    const client = createClient()
    if (args.clear || args.tokens) {
      const tokens = args.clear ? null : Number(String(args.tokens).replace(/[,_]/g, ''))
      if (tokens !== null && !(Number.isSafeInteger(tokens) && tokens > 0)) {
        throw new Error(`not a whole number of tokens: ${args.tokens}`)
      }
      const body: SetModelWindowRequest = { model: args.model, tokens }
      const { window } = await client.put<SetModelWindowResponse>('/api/config/models/window', body)
      console.log(`${args.model}: ${windowText(window)}`)
      return
    }
    const { chat } = await client.get<ModelsResponse>('/api/config/models')
    const entry = chat.find((model) => model.value === args.model)
    if (!entry) {
      throw new Error(
        `${args.model} is not a chat model (see: bazilion provider models <provider>)`,
      )
    }
    console.log(`${args.model}: ${windowText(entry.window)}`)
  },
})

async function setEnabled(name: string, enabled: boolean): Promise<void> {
  const res = await createClient().put<SetProviderEnabledResponse>(
    apiPath('config', 'providers', name, 'enabled'),
    { enabled },
  )
  console.log(`${res.name}: ${res.enabled ? 'enabled' : 'disabled'}`)
}

const enableCmd = defineCommand({
  meta: { name: 'enable', description: 'Switch a connected provider back on' },
  args: { name: providerArg },
  run: ({ args }) => setEnabled(args.name, true),
})

const disableCmd = defineCommand({
  meta: {
    name: 'disable',
    description: 'Pause a provider without removing its key; Agents on its models are refused',
  },
  args: { name: providerArg },
  run: ({ args }) => setEnabled(args.name, false),
})

const testCmd = defineCommand({
  meta: {
    name: 'test',
    description: 'Test a provider (its cheapest model in use) or send one chat to a provider:model',
  },
  args: {
    model: positional('Provider id, or a model string such as anthropic:claude-haiku-5-5'),
    message: { type: 'string', description: 'Message text for a model string' },
  },
  async run({ args }) {
    const client = createClient()
    if (!args.model.includes(':')) {
      const { check } = await client.post<TestProviderResponse>(
        apiPath('config', 'providers', args.model, 'test'),
      )
      if (check.ok) {
        console.log(`${args.model}: ${checkLine(check)}`)
        return
      }
      if (check.failure) printFailure(check.failure)
      process.exitCode = 1
      return
    }
    const body: ProviderTestRequest = { model: args.model, message: args.message }
    console.log(`-> ${args.model}: ${args.message ?? 'say hi briefly'}`)
    const res = await client.post<ProviderTestResponse>('/api/providers/test', body)
    console.log(`<- ${res.content}`)
    if (res.usage) {
      console.log(`(${res.usage.promptTokens} in, ${res.usage.completionTokens} out)`)
    }
  },
})

export const providerCommand = defineCommand({
  meta: { name: 'provider', description: 'Connect, test and manage LLM providers' },
  subCommands: {
    list: listCmd,
    connect: connectCmd,
    disconnect: disconnectCmd,
    test: testCmd,
    models: modelsCmd,
    'models-set': modelsSetCmd,
    window: windowCmd,
    enable: enableCmd,
    disable: disableCmd,
  },
})
