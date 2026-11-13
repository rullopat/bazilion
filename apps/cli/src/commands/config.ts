import type {
  ProviderConfigResponse,
  ServiceCard,
  ServiceConfigResponse,
  ServiceFieldState,
  SetFieldRequest,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { apiPath, positional, printRows } from '../command-helpers.ts'

function displayValue(f: ServiceFieldState): string {
  if (!f.set) return '(unset)'
  if (f.kind === 'secret') return f.preview ?? '(set)'
  return f.value ?? '(set)'
}

const listCmd = defineCommand({
  meta: {
    name: 'list',
    description: 'List every configurable field (credentials + URLs) across all services',
  },
  async run() {
    const client = createClient()
    // Both endpoints return ServiceCard-shaped entries — merge and print.
    const { providers } = await client.get<ProviderConfigResponse>('/api/config/providers')
    const { services } = await client.get<ServiceConfigResponse>('/api/config/services')
    const all: ServiceCard[] = [...providers, ...services]

    printRows(
      all.flatMap((svc) => svc.fields.map((f) => [svc.id, f.envVar, f.kind, displayValue(f)])),
      '(no fields registered)',
    )
    for (const svc of services) {
      if (svc.status) console.log(`\n${svc.displayName}: ${svc.status}`)
      for (const field of svc.fields) {
        if (field.options)
          console.log(
            `${field.envVar} choices: ${field.options.map((value) => (field.optionLabels?.[value] ? `${value} (${field.optionLabels[value]})` : value)).join(', ')}`,
          )
      }
    }
  },
})

const setCmd = defineCommand({
  meta: {
    name: 'set',
    description: 'Set a configurable field (auto-routes to secrets or plaintext store)',
  },
  args: {
    envVar: positional('Env var name (e.g. ANTHROPIC_API_KEY, LMSTUDIO_URL)'),
    value: positional('New value (empty string clears the field)'),
  },
  async run({ args }) {
    const body: SetFieldRequest = { value: args.value }
    const state = await createClient().put<ServiceFieldState>(
      apiPath('config', 'fields', args.envVar),
      body,
    )
    console.log(`${state.envVar} (${state.kind}): ${displayValue(state)}`)
  },
})

const rmCmd = defineCommand({
  meta: { name: 'rm', description: 'Remove a configurable field value' },
  args: {
    envVar: positional('Env var name to clear'),
  },
  async run({ args }) {
    await createClient().del(apiPath('config', 'fields', args.envVar))
    console.log(`removed ${args.envVar}`)
  },
})

export const configCommand = defineCommand({
  meta: {
    name: 'config',
    description: 'Service settings: credentials (stored encrypted) and URLs/IDs (plaintext)',
  },
  subCommands: {
    list: listCmd,
    set: setCmd,
    rm: rmCmd,
  },
})
