import type { McpServer, McpToolInfo, McpTransport } from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { Button } from '../../components/Button'
import { ConfigPage } from '../../components/ConfigPage'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ItemList, ItemRow, SectionCard, StatusBadge } from '../../components/Page'
import { api, errorMessage } from '../../lib/api'
import { daemonClient } from '../../lib/daemon-client'

const fetchServers = createServerFn({ method: 'GET' }).handler(() =>
  daemonClient().get<{ servers: McpServer[] }>('/api/mcp-servers'),
)

export const Route = createFileRoute('/config/mcp')({
  loader: () => fetchServers(),
  component: McpPage,
})

const serverPath = (id: string) => `/api/mcp-servers/${encodeURIComponent(id)}`

function McpPage() {
  const { servers } = Route.useLoaderData()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [tests, setTests] = useState<
    Record<string, { kind: 'pending' | 'success' | 'error'; message: string }>
  >({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<McpServer | null>(null)

  async function toggle(server: McpServer) {
    setBusyId(server.id)
    setError(null)
    try {
      await api(serverPath(server.id), { method: 'PATCH', body: { enabled: !server.enabled } })
      await router.invalidate()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusyId(null)
    }
  }

  async function test(id: string) {
    setTests((current) => ({ ...current, [id]: { kind: 'pending', message: 'Connecting…' } }))
    let result: { kind: 'success' | 'error'; message: string }
    try {
      const body = await api<{ ok: boolean; tools?: McpToolInfo[]; error?: string }>(
        `${serverPath(id)}/test`,
        { method: 'POST' },
      )
      const tools = body.tools ?? []
      result = body.ok
        ? {
            kind: 'success',
            message: `${tools.length} tools: ${tools.map((tool) => tool.name).join(', ')}`,
          }
        : { kind: 'error', message: body.error ?? 'Test failed' }
    } catch (cause) {
      result = { kind: 'error', message: errorMessage(cause) }
    }
    setTests((current) => ({ ...current, [id]: result }))
  }

  return (
    <ConfigPage
      title="MCP servers"
      description={
        <>
          Tools from these Model Context Protocol servers are offered to every agent turn as{' '}
          <code className="font-mono">mcp__&lt;server&gt;__&lt;tool&gt;</code>. A stdio server runs
          as a daemon child process with the configured provider keys and secrets, never Bazilion's
          own credentials; a Streamable HTTP server can use a bearer token.
        </>
      }
    >
      <AddServerForm onAdded={() => router.invalidate()} />
      {error && (
        <p role="alert" className="err">
          {error}
        </p>
      )}

      <SectionCard title="Servers">
        {servers.length === 0 ? (
          <p className="muted">No MCP servers yet; add one above.</p>
        ) : (
          <ItemList>
            {servers.map((server) => {
              const result = tests[server.id]
              return (
                <ItemRow
                  key={server.id}
                  title={server.name}
                  meta={
                    <>
                      <StatusBadge variant={server.enabled ? 'success' : 'neutral'}>
                        {server.enabled ? 'enabled' : 'disabled'}
                      </StatusBadge>
                      <span>{server.transport}</span>
                      {server.hasAuthToken && <span>bearer token</span>}
                      <code className="break-all">
                        {server.transport === 'stdio'
                          ? `${server.command ?? ''} ${server.args.join(' ')}`.trim()
                          : server.url}
                      </code>
                    </>
                  }
                  actions={
                    <>
                      <Button variant="ghost" onClick={() => void test(server.id)}>
                        Test
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busyId === server.id}
                        onClick={() => void toggle(server)}
                      >
                        {busyId === server.id ? 'Working…' : server.enabled ? 'Disable' : 'Enable'}
                      </Button>
                      <Button
                        variant="danger"
                        disabled={busyId === server.id}
                        onClick={() => setDeleteTarget(server)}
                      >
                        Delete
                      </Button>
                    </>
                  }
                >
                  {result && (
                    <p
                      role={result.kind === 'error' ? 'alert' : 'status'}
                      className={`mb-0 mt-2 break-words text-xs ${
                        result.kind === 'error'
                          ? 'text-danger'
                          : result.kind === 'success'
                            ? 'text-success'
                            : 'text-muted-foreground'
                      }`}
                    >
                      {result.message}
                    </p>
                  )}
                </ItemRow>
              )
            })}
          </ItemList>
        )}
      </SectionCard>
      <ConfirmDialog
        open={deleteTarget !== null}
        title={`Delete MCP server ${deleteTarget?.name ?? ''}?`}
        description={
          <p>
            This removes the server and its stored bearer token, closes its connection and removes
            its tools from later Agent turns.
          </p>
        }
        confirmLabel="Delete MCP server"
        onConfirm={async () => {
          if (!deleteTarget) return
          await api(serverPath(deleteTarget.id), { method: 'DELETE' })
          await router.invalidate()
        }}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      />
    </ConfigPage>
  )
}

function AddServerForm({ onAdded }: { onAdded: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [transport, setTransport] = useState<McpTransport>('stdio')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function add(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await api('/api/mcp-servers', {
        body: {
          name,
          transport,
          command: transport === 'stdio' ? command : null,
          args: transport === 'stdio' ? args.split(' ').filter(Boolean) : [],
          url: transport === 'stdio' ? null : url,
          authToken: token || undefined,
        },
      })
      setName('')
      setCommand('')
      setArgs('')
      setUrl('')
      setToken('')
      await onAdded()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard title="Add a server">
      <form onSubmit={(event) => void add(event)}>
        <div className="grid gap-x-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <label>
            Name
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              placeholder="playwright"
              pattern="[a-zA-Z0-9_]+"
            />
          </label>
          <label>
            Transport
            <select
              value={transport}
              onChange={(event) => setTransport(event.target.value as McpTransport)}
            >
              <option value="stdio">stdio</option>
              <option value="http">http</option>
            </select>
          </label>
        </div>
        {transport === 'stdio' ? (
          <div className="grid gap-x-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <label>
              Command
              <input
                type="text"
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder="npx"
              />
            </label>
            <label>
              Args (space-separated)
              <input
                type="text"
                value={args}
                onChange={(event) => setArgs(event.target.value)}
                placeholder="-y @modelcontextprotocol/server-filesystem /srv/data"
              />
            </label>
          </div>
        ) : (
          <div className="grid gap-x-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
            <label>
              URL
              <input
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://mcp.example.com/mcp"
              />
            </label>
            <label>
              Bearer token (optional)
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                autoComplete="off"
              />
            </label>
          </div>
        )}
        <Button variant="primary" type="submit" disabled={busy} className="mt-2">
          {busy ? 'Adding…' : 'Add server'}
        </Button>
        {error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </SectionCard>
  )
}
