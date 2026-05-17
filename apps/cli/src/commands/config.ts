import type {
  ProviderConfigResponse,
  ServiceCard,
  ServiceConfigResponse,
  ServiceFieldState,
  SetFieldRequest,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { columnize } from '../columnize.ts'

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

    const rows: string[][] = []
    for (const svc of all) {
      for (const f of svc.fields) {
        rows.push([svc.id, f.envVar, f.kind, displayValue(f)])
      }
    }
    if (rows.length === 0) {
      console.log('(no fields registered)')
      return
    }
    for (const line of columnize(rows)) console.log(line)
  },
})

const setCmd = defineCommand({
  meta: {
    name: 'set',
    description: 'Set a configurable field (auto-routes to secrets or plaintext store)',
  },
  args: {
    envVar: {
      type: 'positional',
      required: true,
      description: 'Env var name (e.g. ANTHROPIC_API_KEY, LMSTUDIO_URL)',
    },
    value: {
      type: 'positional',
      required: true,
      description: 'New value (empty string clears the field)',
    },
  },
  async run({ args }) {
    const client = createClient()
    const body: SetFieldRequest = { value: args.value }
    const state = await client.put<ServiceFieldState>(
      `/api/config/fields/${encodeURIComponent(args.envVar)}`,
      body,
    )
    console.log(`${state.envVar} (${state.kind}): ${displayValue(state)}`)
  },
})

const rmCmd = defineCommand({
  meta: { name: 'rm', description: 'Remove a configurable field value' },
  args: {
    envVar: { type: 'positional', required: true, description: 'Env var name to clear' },
  },
  async run({ args }) {
    const client = createClient()
    await client.del(`/api/config/fields/${encodeURIComponent(args.envVar)}`)
    console.log(`removed ${args.envVar}`)
  },
})

export const configCommand = defineCommand({
  meta: {
    name: 'config',
    description:
      'Manage service configuration — credentials (encrypted) and URLs/IDs (plaintext), unified under one CLI',
  },
  subCommands: {
    list: listCmd,
    set: setCmd,
    rm: rmCmd,
  },
})
