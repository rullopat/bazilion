import {
  MCP_PRESETS,
  type McpServer,
  type McpServerInput,
  type McpToolInfo,
  type McpTransport,
  presetServer,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { apiPath, positional, printJson, printRows } from '../command-helpers.ts'
import { collectFlagValues } from '../repeatable-args.ts'

const serverArg = positional('MCP server id')

function serverRow(s: McpServer): string[] {
  const where = s.transport === 'stdio' ? `${s.command} ${s.args.join(' ')}`.trim() : (s.url ?? '')
  return [
    s.id,
    s.enabled ? 'enabled' : 'disabled',
    s.transport,
    s.hasAuthToken ? 'auth' : '-',
    s.name,
    where,
  ]
}

/** `NAME=value` flags as an object; a bare `NAME` (for --unset-env) maps to null. */
function envFlags(
  raw: readonly string[],
  name: string,
  unset = false,
): Record<string, string | null> {
  const env: Record<string, string | null> = {}
  for (const value of collectFlagValues(raw, name)) {
    if (unset) {
      env[value] = null
      continue
    }
    const at = value.indexOf('=')
    if (at <= 0) throw new Error(`--${name} takes NAME=value, not ${value}`)
    env[value.slice(0, at)] = value.slice(at + 1)
  }
  return env
}

const toolList = (value: string) =>
  value
    .split(',')
    .map((tool) => tool.trim())
    .filter(Boolean)

/**
 * `--ask send-mail --skip get-thing` → those choices, replacing the earlier ones; `--ask default`
 * → none, so every tool follows the default rule. undefined when neither flag is given.
 */
function askFlags(args: {
  ask?: string
  skip?: string
}): Record<string, boolean> | null | undefined {
  if (args.ask === undefined && args.skip === undefined) return undefined
  if (args.ask === 'default') {
    if (args.skip !== undefined) throw new Error('--ask default cannot go with --skip')
    return null
  }
  const choices: Record<string, boolean> = {}
  for (const tool of toolList(args.ask ?? '')) choices[tool] = true
  for (const tool of toolList(args.skip ?? '')) {
    if (choices[tool]) throw new Error(`${tool} is in both --ask and --skip`)
    choices[tool] = false
  }
  return choices
}

const ASK_ARGS = {
  ask: {
    type: 'string',
    description:
      'Tools that ask you before each call, comma-separated (by default: those whose names send, post, change or delete); "default" clears your choices',
  },
  skip: {
    type: 'string',
    description: 'Tools that never ask, comma-separated',
  },
} as const

/** Which tools ask first, as a line: the default rule and the operator's choices. */
function asksLine(server: McpServer): string {
  const choices = Object.entries(server.ask ?? {})
  if (choices.length === 0) return 'by default'
  return `by default, except ${choices
    .map(([tool, asks]) => `${tool} (${asks ? 'asks' : 'never asks'})`)
    .join(', ')}`
}

const addCmd = defineCommand({
  meta: { name: 'add', description: 'Register an MCP server, or one of the common connections' },
  args: {
    name: { type: 'positional', required: true, description: 'Unique name ([a-zA-Z0-9_])' },
    preset: {
      type: 'string',
      description: `A common connection: ${MCP_PRESETS.map((preset) => preset.id).join(', ')} (see mcp presets)`,
    },
    option: { type: 'string', description: "A preset's option, e.g. org or post (repeatable)" },
    transport: { type: 'string', description: 'stdio | http (default stdio)' },
    command: { type: 'string', description: 'stdio: executable to run (e.g. npx)' },
    args: { type: 'string', description: 'stdio: space-separated args (quote the whole string)' },
    url: { type: 'string', description: 'http: Streamable HTTP endpoint URL' },
    token: { type: 'string', description: 'http: bearer token (stored encrypted)' },
    env: {
      type: 'string',
      description: 'stdio: a variable of its own as NAME=value, stored encrypted (repeatable)',
    },
    ...ASK_ARGS,
    disabled: { type: 'boolean', description: 'Create disabled' },
  },
  async run({ args, rawArgs }) {
    const env = envFlags(rawArgs, 'env')
    let body: McpServerInput
    if (args.preset) {
      const preset = MCP_PRESETS.find((entry) => entry.id === args.preset)
      if (!preset)
        throw new Error(`no common connection "${args.preset}"; see bazilion mcp presets`)
      // A preset says how the server runs: these would be ignored.
      const given = (['transport', 'command', 'args', 'url', 'token'] as const).filter(
        (flag) => args[flag] !== undefined,
      )
      if (given.length > 0)
        throw new Error(
          `--preset sets how it runs: leave out ${given.map((f) => `--${f}`).join(', ')}`,
        )
      const chosen = collectFlagValues(rawArgs, 'option')
      const unknown = chosen.filter((id) => !preset.options.some((option) => option.id === id))
      if (unknown.length > 0) {
        const known = preset.options.map((option) => option.id).join(', ')
        throw new Error(
          `${preset.title} has no option ${unknown.join(', ')}${known ? `; its options: ${known}` : ''}`,
        )
      }
      const values = Object.fromEntries(
        Object.entries(env).filter((pair): pair is [string, string] => pair[1] !== null),
      )
      const missing = preset.fields.filter((field) => !values[field.name])
      if (missing.length > 0) {
        throw new Error(
          `${preset.title} needs ${missing.map((field) => `--env ${field.name}=…`).join(' ')}`,
        )
      }
      const made = presetServer(preset, {
        name: args.name,
        chosen,
        values,
      })
      body = {
        name: made.name,
        transport: 'stdio',
        command: made.command,
        args: made.args,
        env: { ...made.env, ...env },
        enabled: !args.disabled,
      }
    } else {
      body = {
        name: args.name,
        transport: (args.transport ?? 'stdio') as McpTransport,
        command: args.command ?? null,
        args: args.args ? args.args.split(' ').filter(Boolean) : [],
        url: args.url ?? null,
        authToken: args.token ?? undefined,
        ...(Object.keys(env).length > 0 ? { env } : {}),
        enabled: !args.disabled,
      }
    }
    const ask = askFlags(args)
    if (ask !== undefined) body.ask = ask
    const { server } = await createClient().post<{ server: McpServer }>('/api/mcp-servers', body)
    console.log(`${server.id}\t${server.name}\t${server.transport}`)
  },
})

const presetsCmd = defineCommand({
  meta: { name: 'presets', description: 'List the common connections mcp add --preset knows' },
  run() {
    for (const preset of MCP_PRESETS) {
      console.log(`${preset.id}\t${preset.title}: ${preset.does}`)
      console.log(`  runs: ${[preset.command, ...preset.args].join(' ')}`)
      for (const field of preset.fields) console.log(`  --env ${field.name}=…  ${field.hint}`)
      for (const option of preset.options) console.log(`  --option ${option.id}  ${option.hint}`)
      if (preset.needs) console.log(`  needs: ${preset.needs}`)
      console.log(`  sign-in: ${preset.signIn}`)
      if (preset.caveat) console.log(`  note: ${preset.caveat}`)
      console.log(`  guide: ${preset.guide}`)
    }
  },
})

const setCmd = defineCommand({
  meta: { name: 'set', description: "Change a server's own variables or which tools ask first" },
  args: {
    id: serverArg,
    env: { type: 'string', description: 'Set a variable as NAME=value (repeatable)' },
    'unset-env': { type: 'string', description: 'Remove a variable by name (repeatable)' },
    ...ASK_ARGS,
  },
  async run({ args, rawArgs }) {
    const env = { ...envFlags(rawArgs, 'env'), ...envFlags(rawArgs, 'unset-env', true) }
    const body: Partial<McpServerInput> = {}
    if (Object.keys(env).length > 0) body.env = env
    const ask = askFlags(args)
    if (ask !== undefined) body.ask = ask
    if (Object.keys(body).length === 0)
      throw new Error('nothing to change: give --env, --unset-env, --ask or --skip')
    const { server } = await createClient().patch<{ server: McpServer }>(
      apiPath('mcp-servers', args.id),
      body,
    )
    console.log(
      `${server.name}: variables ${server.envNames?.join(', ') || '(none)'}; asks first: ${asksLine(server)}`,
    )
  },
})

const listCmd = defineCommand({
  meta: { name: 'list', description: 'List MCP servers' },
  async run() {
    const { servers } = await createClient().get<{ servers: McpServer[] }>('/api/mcp-servers')
    printRows(servers.map(serverRow), '(no MCP servers)')
  },
})

const showCmd = defineCommand({
  meta: { name: 'show', description: 'Show one MCP server' },
  args: { id: serverArg },
  async run({ args }) {
    const { server } = await createClient().get<{ server: McpServer }>(
      apiPath('mcp-servers', args.id),
    )
    printJson(server)
  },
})

const rmCmd = defineCommand({
  meta: { name: 'rm', description: 'Delete an MCP server' },
  args: { id: serverArg },
  async run({ args }) {
    await createClient().del(apiPath('mcp-servers', args.id))
    console.log(`removed MCP server ${args.id}`)
  },
})

const enableCmd = defineCommand({
  meta: { name: 'enable', description: 'Enable an MCP server' },
  args: { id: serverArg },
  async run({ args }) {
    await createClient().patch(apiPath('mcp-servers', args.id), { enabled: true })
    console.log(`enabled MCP server ${args.id}`)
  },
})

const disableCmd = defineCommand({
  meta: { name: 'disable', description: 'Disable an MCP server' },
  args: { id: serverArg },
  async run({ args }) {
    await createClient().patch(apiPath('mcp-servers', args.id), { enabled: false })
    console.log(`disabled MCP server ${args.id}`)
  },
})

const testCmd = defineCommand({
  meta: { name: 'test', description: 'Connect to a server and list its tools' },
  args: { id: serverArg },
  async run({ args }) {
    const res = await createClient().post<{ ok: boolean; tools?: McpToolInfo[]; error?: string }>(
      apiPath('mcp-servers', args.id, 'test'),
    )
    if (!res.ok) throw new Error(`connection failed: ${res.error}`)
    const tools = res.tools ?? []
    console.log(`connected — ${tools.length} tool(s):`)
    for (const t of tools)
      console.log(`  ${t.asks ? '(asks first) ' : ''}${t.name}\t${t.description}`)
  },
})

export const mcpCommand = defineCommand({
  meta: { name: 'mcp', description: 'Manage MCP servers' },
  subCommands: {
    add: addCmd,
    list: listCmd,
    show: showCmd,
    rm: rmCmd,
    enable: enableCmd,
    disable: disableCmd,
    test: testCmd,
    set: setCmd,
    presets: presetsCmd,
  },
})
