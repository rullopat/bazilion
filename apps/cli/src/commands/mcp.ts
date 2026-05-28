import type { McpServer, McpServerInput, McpToolInfo, McpTransport } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { columnize } from '../columnize.ts'

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

const addCmd = defineCommand({
  meta: { name: 'add', description: 'Register an MCP server' },
  args: {
    name: { type: 'positional', required: true, description: 'Unique name ([a-zA-Z0-9_-])' },
    transport: { type: 'string', description: 'stdio | http | sse (default stdio)' },
    command: { type: 'string', description: 'stdio: executable to run (e.g. npx)' },
    args: { type: 'string', description: 'stdio: space-separated args (quote the whole string)' },
    url: { type: 'string', description: 'http/sse: endpoint URL' },
    token: { type: 'string', description: 'http/sse: bearer token (stored encrypted)' },
    disabled: { type: 'boolean', description: 'Create disabled' },
  },
  async run({ args }) {
    const transport = (args.transport ?? 'stdio') as McpTransport
    const body: McpServerInput = {
      name: args.name,
      transport,
      command: args.command ?? null,
      args: args.args ? args.args.split(' ').filter(Boolean) : [],
      url: args.url ?? null,
      authToken: args.token ?? undefined,
      enabled: !args.disabled,
    }
    const client = createClient()
    const { server } = await client.post<{ server: McpServer }>('/api/mcp-servers', body)
    console.log(`${server.id}\t${server.name}\t${server.transport}`)
  },
})

const listCmd = defineCommand({
  meta: { name: 'list', description: 'List MCP servers' },
  async run() {
    const client = createClient()
    const { servers } = await client.get<{ servers: McpServer[] }>('/api/mcp-servers')
    if (servers.length === 0) {
      console.log('(no MCP servers)')
      return
    }
    for (const line of columnize(servers.map(serverRow))) console.log(line)
  },
})

const showCmd = defineCommand({
  meta: { name: 'show', description: 'Show one MCP server' },
  args: { id: { type: 'positional', required: true } },
  async run({ args }) {
    const client = createClient()
    const { server } = await client.get<{ server: McpServer }>(`/api/mcp-servers/${args.id}`)
    console.log(JSON.stringify(server, null, 2))
  },
})

const rmCmd = defineCommand({
  meta: { name: 'rm', description: 'Delete an MCP server' },
  args: { id: { type: 'positional', required: true } },
  async run({ args }) {
    const client = createClient()
    await client.del(`/api/mcp-servers/${args.id}`)
    console.log(`removed MCP server ${args.id}`)
  },
})

const enableCmd = defineCommand({
  meta: { name: 'enable', description: 'Enable an MCP server' },
  args: { id: { type: 'positional', required: true } },
  async run({ args }) {
    const client = createClient()
    await client.patch(`/api/mcp-servers/${args.id}`, { enabled: true })
    console.log(`enabled MCP server ${args.id}`)
  },
})

const disableCmd = defineCommand({
  meta: { name: 'disable', description: 'Disable an MCP server' },
  args: { id: { type: 'positional', required: true } },
  async run({ args }) {
    const client = createClient()
    await client.patch(`/api/mcp-servers/${args.id}`, { enabled: false })
    console.log(`disabled MCP server ${args.id}`)
  },
})

const testCmd = defineCommand({
  meta: { name: 'test', description: 'Connect to a server and list its tools' },
  args: { id: { type: 'positional', required: true } },
  async run({ args }) {
    const client = createClient()
    const res = await client.post<{ ok: boolean; tools?: McpToolInfo[]; error?: string }>(
      `/api/mcp-servers/${args.id}/test`,
    )
    if (!res.ok) {
      console.error(`connection failed: ${res.error}`)
      process.exitCode = 1
      return
    }
    const tools = res.tools ?? []
    console.log(`connected — ${tools.length} tool(s):`)
    for (const t of tools) console.log(`  ${t.name}\t${t.description}`)
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
  },
})
