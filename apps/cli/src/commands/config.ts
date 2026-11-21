import type {
  ProviderConfigResponse,
  ServiceCard,
  ServiceFieldState,
  SetFieldRequest,
  SetFieldsRequest,
  SetFieldsResponse,
  ToolsResponse,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { apiPath, positional, printRows } from '../command-helpers.ts'

function displayValue(f: ServiceFieldState): string {
  const source = f.environment ? ' (from the daemon’s environment)' : ''
  if (f.kind === 'secret') return f.set ? `${f.preview ?? '(set)'}${source}` : `(unset)${source}`
  if (f.environment) return `${f.effective ?? ''}${source}`
  if (f.set) return f.value ?? '(set)'
  return f.effective ? `${f.effective} (default)` : '(unset)'
}

/** What a setting takes, when it is more specific than text. */
function accepts(field: ServiceFieldState): string | undefined {
  const input = field.input
  switch (input.type) {
    case 'choice':
      return input.options.map((option) => `${option.value} (${option.label})`).join(', ')
    case 'switch':
      // Yes or no reads the same whichever way round the page shows it.
      return [input.on, input.off].includes('true')
        ? 'true or false'
        : `${input.on} or ${input.off}`
    case 'number': {
      const shown = input.scale
        ? ` (the Tools page shows ${input.unit ?? 'units'}: ${input.scale} each)`
        : ''
      return `a whole number from ${input.min} to ${input.max}${shown}`
    }
    default:
      return undefined
  }
}

const listCmd = defineCommand({
  meta: {
    name: 'list',
    description:
      'List every setting of providers, model functions and tools, and what is in effect',
  },
  async run() {
    const client = createClient()
    // Providers, model functions and tools all carry fields: merge and print.
    const { providers } = await client.get<ProviderConfigResponse>('/api/config/providers')
    const { tools, functions } = await client.get<ToolsResponse>('/api/config/tools')
    const cards = [...functions, ...tools]
    const all: Pick<ServiceCard, 'id' | 'fields'>[] = [...providers, ...cards]

    printRows(
      all.flatMap((svc) => svc.fields.map((f) => [svc.id, f.envVar, f.kind, displayValue(f)])),
      '(no fields registered)',
    )
    console.log('')
    for (const card of cards) {
      const state = [card.state?.label, card.note].filter(Boolean).join('. ')
      if (state) console.log(`${card.displayName}: ${state}`)
      for (const field of card.fields) {
        if (field.input.type !== 'choice') continue
        const chosen = field.input.options.find((option) => option.value === field.effective)
        if (chosen?.note) console.log(`  ${chosen.note.text}`)
      }
    }
    console.log('')
    for (const card of cards) {
      for (const field of card.fields) {
        const takes = accepts(field)
        if (takes) console.log(`${field.envVar}: ${takes}`)
      }
    }
  },
})

const setCmd = defineCommand({
  meta: {
    name: 'set',
    description:
      'Set one setting (NAME value), or several that are saved together (NAME=value NAME=value)',
  },
  args: {
    envVar: positional('Setting name (e.g. ANTHROPIC_API_KEY), or NAME=value'),
    value: {
      type: 'positional',
      required: false,
      description: 'New value (an empty string clears the setting)',
    },
  },
  async run({ args }) {
    const client = createClient()
    if (!args.envVar.includes('=')) {
      if (args.value === undefined) {
        throw new Error(`give ${args.envVar} a value, or use NAME=value`)
      }
      const body: SetFieldRequest = { value: args.value }
      const state = await client.put<ServiceFieldState>(
        apiPath('config', 'fields', args.envVar),
        body,
      )
      console.log(`${state.envVar} (${state.kind}): ${displayValue(state)}`)
      return
    }
    // NAME=value pairs: checked together, and stored only when all of them pass.
    const values: Record<string, string> = {}
    for (const token of args._) {
      const at = token.indexOf('=')
      if (at <= 0) throw new Error(`expected NAME=value, got "${token}"`)
      values[token.slice(0, at)] = token.slice(at + 1)
    }
    const body: SetFieldsRequest = { values }
    const { fields } = await client.put<SetFieldsResponse>('/api/config/fields', body)
    for (const state of fields) {
      console.log(`${state.envVar} (${state.kind}): ${displayValue(state)}`)
    }
  },
})

const rmCmd = defineCommand({
  meta: { name: 'rm', description: 'Remove a setting, back to its default' },
  args: {
    envVar: positional('Setting name to clear'),
  },
  async run({ args }) {
    await createClient().del(apiPath('config', 'fields', args.envVar))
    console.log(`removed ${args.envVar}`)
  },
})

export const configCommand = defineCommand({
  meta: {
    name: 'config',
    description: 'Settings: credentials (stored encrypted), choices, switches and addresses',
  },
  subCommands: {
    list: listCmd,
    set: setCmd,
    rm: rmCmd,
  },
})
