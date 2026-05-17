import type {
  ProviderConfigResponse,
  ProviderTestRequest,
  ProviderTestResponse,
  SetProviderEnabledResponse,
  SetProviderModelsRequest,
  SetProviderModelsResponse,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { columnize } from '../columnize.ts'

const listCmd = defineCommand({
  meta: {
    name: 'list',
    description: 'List all providers with enabled/disabled state and curated model counts',
  },
  args: {
    enabled: { type: 'boolean', description: 'Show only enabled providers' },
  },
  async run({ args }) {
    const client = createClient()
    const { providers } = await client.get<ProviderConfigResponse>('/api/config/providers')
    const filtered = args.enabled ? providers.filter((p) => p.enabled) : providers
    if (filtered.length === 0) {
      console.log('(no providers to show)')
      return
    }
    const rows = filtered.map((p) => [
      p.id,
      p.enabled ? 'enabled' : 'disabled',
      `${p.curated.length} curated`,
      `${p.catalog.length} catalog`,
      p.enabled ? '' : `(set ${p.envHint})`,
    ])
    for (const line of columnize(rows)) console.log(line)
  },
})

const modelsCmd = defineCommand({
  meta: {
    name: 'models',
    description: 'Show curated + catalog + live models for one provider',
  },
  args: {
    name: { type: 'positional', required: true, description: 'Provider name' },
  },
  async run({ args }) {
    const client = createClient()
    const { providers } = await client.get<ProviderConfigResponse>('/api/config/providers')
    const p = providers.find((x) => x.id === args.name)
    if (!p) {
      console.error(`unknown provider: ${args.name}`)
      process.exit(1)
    }
    console.log(`# ${p.id} (${p.enabled ? 'enabled' : 'disabled'})`)
    if (!p.enabled) console.log(`  (set ${p.envHint} to enable)`)

    console.log('\n## curated')
    if (p.curated.length === 0) console.log('  (none — use `provider models-set` to pin some)')
    else for (const m of p.curated) console.log(`  ${m}`)

    console.log('\n## catalog (from pi-ai)')
    if (p.catalog.length === 0) console.log('  (empty)')
    else for (const m of p.catalog) console.log(`  ${m}`)

    if (p.live) {
      console.log('\n## live (from upstream /v1/models)')
      if (p.live.error) console.log(`  (error: ${p.live.error})`)
      else if (p.live.models.length === 0) console.log('  (empty)')
      else for (const m of p.live.models) console.log(`  ${m}`)
    }
  },
})

const modelsSetCmd = defineCommand({
  meta: {
    name: 'models-set',
    description: 'Replace the curated model list for a provider (comma-separated)',
  },
  args: {
    name: { type: 'positional', required: true, description: 'Provider name' },
    models: {
      type: 'positional',
      required: true,
      description: 'Comma-separated model list (empty string clears the list)',
    },
  },
  async run({ args }) {
    const client = createClient()
    const models = args.models
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const body: SetProviderModelsRequest = { models }
    const saved = await client.put<SetProviderModelsResponse>(
      `/api/config/providers/${encodeURIComponent(args.name)}/models`,
      body,
    )
    console.log(`saved ${saved.models.length} curated model(s) for ${args.name}`)
    for (const m of saved.models) console.log(`  ${m}`)
  },
})

const enableCmd = defineCommand({
  meta: { name: 'enable', description: 'Toggle a provider on so agents can use it' },
  args: {
    name: { type: 'positional', required: true, description: 'Provider id (e.g. anthropic)' },
  },
  async run({ args }) {
    const client = createClient()
    const res = await client.put<SetProviderEnabledResponse>(
      `/api/config/providers/${encodeURIComponent(args.name)}/enabled`,
      { enabled: true },
    )
    console.log(`${res.name}: enabled`)
  },
})

const disableCmd = defineCommand({
  meta: {
    name: 'disable',
    description: 'Toggle a provider off — agents will refuse its model strings',
  },
  args: {
    name: { type: 'positional', required: true, description: 'Provider id' },
  },
  async run({ args }) {
    const client = createClient()
    const res = await client.put<SetProviderEnabledResponse>(
      `/api/config/providers/${encodeURIComponent(args.name)}/enabled`,
      { enabled: false },
    )
    console.log(`${res.name}: disabled`)
  },
})

const testCmd = defineCommand({
  meta: { name: 'test', description: 'Send a single chat to a model and print the reply' },
  args: {
    model: {
      type: 'positional',
      required: true,
      description: 'Model string, e.g. anthropic:claude-opus-4-6',
    },
    message: { type: 'string', description: 'Message text (default "say hi briefly")' },
  },
  async run({ args }) {
    const client = createClient()
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
  meta: { name: 'provider', description: 'Manage and test LLM providers' },
  subCommands: {
    list: listCmd,
    enable: enableCmd,
    disable: disableCmd,
    models: modelsCmd,
    'models-set': modelsSetCmd,
    test: testCmd,
  },
})
