import type { McpServer, McpToolInfo, McpTransport } from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { ConfigTabs } from '../../components/ConfigTabs'
import { daemonClient } from '../../lib/daemon-client'

const fetchServers = createServerFn({ method: 'GET' }).handler(() =>
  daemonClient().get<{ servers: McpServer[] }>('/api/mcp-servers'),
)

export const Route = createFileRoute('/config/mcp')({
  loader: () => fetchServers(),
  component: McpPage,
})

const TRANSPORTS: McpTransport[] = ['stdio', 'http', 'sse']

function McpPage() {
  const { servers } = Route.useLoaderData()
  const router = useRouter()
  const [name, setName] = useState('')
  const [transport, setTransport] = useState<McpTransport>('stdio')
  const [command, setCommand] = useState('')
  const [argsStr, setArgsStr] = useState('')
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [testResult, setTestResult] = useState<Record<string, string>>({})

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    try {
      const body = {
        name,
        transport,
        command: transport === 'stdio' ? command : null,
        args: transport === 'stdio' ? argsStr.split(' ').filter(Boolean) : [],
        url: transport === 'stdio' ? null : url,
        authToken: token || undefined,
      }
      const res = await fetch('/api/mcp-servers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `${res.status} ${res.statusText}`)
      }
      setName('')
      setCommand('')
      setArgsStr('')
      setUrl('')
      setToken('')
      await router.invalidate()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function toggle(s: McpServer) {
    await fetch(`/api/mcp-servers/${s.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: !s.enabled }),
    })
    await router.invalidate()
  }

  async function remove(id: string) {
    await fetch(`/api/mcp-servers/${id}`, { method: 'DELETE' })
    await router.invalidate()
  }

  async function test(id: string) {
    setTestResult((r) => ({ ...r, [id]: 'connecting…' }))
    const res = await fetch(`/api/mcp-servers/${id}/test`, { method: 'POST' })
    const j = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      tools?: McpToolInfo[]
      error?: string
    }
    setTestResult((r) => ({
      ...r,
      [id]: j.ok
        ? `✓ ${j.tools?.length ?? 0} tools: ${(j.tools ?? []).map((t) => t.name).join(', ')}`
        : `✗ ${j.error ?? 'failed'}`,
    }))
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="font-serif text-3xl text-foreground mb-2">config</h1>
      <ConfigTabs active="mcp" />

      <p className="text-muted-foreground text-sm mb-6">
        Model Context Protocol servers. Each enabled server's tools are exposed to every agent,
        namespaced <code className="font-mono">mcp__&lt;server&gt;__&lt;tool&gt;</code>. stdio
        servers run as local subprocesses and inherit your configured secrets; http/sse servers
        connect to a remote endpoint with an optional bearer token.
      </p>

      <section className="rounded-lg border bg-card p-5 mb-6">
        <h3 className="font-serif text-xl mb-3">Add a server</h3>
        <form onSubmit={add} className="space-y-3">
          <div className="flex gap-3 flex-wrap items-end">
            <label className="text-sm">
              Name
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="playwright"
                pattern="[a-zA-Z0-9_-]+"
                className="block mt-1 rounded-md border bg-background px-3 py-2 text-sm w-48"
              />
            </label>
            <label className="text-sm">
              Transport
              <select
                value={transport}
                onChange={(e) => setTransport(e.target.value as McpTransport)}
                className="block mt-1 rounded-md border bg-background px-3 py-2 text-sm"
              >
                {TRANSPORTS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {transport === 'stdio' ? (
            <div className="flex gap-3 flex-wrap items-end">
              <label className="text-sm">
                Command
                <input
                  type="text"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx"
                  className="block mt-1 rounded-md border bg-background px-3 py-2 text-sm w-48"
                />
              </label>
              <label className="text-sm flex-1">
                Args (space-separated)
                <input
                  type="text"
                  value={argsStr}
                  onChange={(e) => setArgsStr(e.target.value)}
                  placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
                  className="block mt-1 rounded-md border bg-background px-3 py-2 text-sm w-full"
                />
              </label>
            </div>
          ) : (
            <div className="flex gap-3 flex-wrap items-end">
              <label className="text-sm flex-1">
                URL
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://mcp.example.com/sse"
                  className="block mt-1 rounded-md border bg-background px-3 py-2 text-sm w-full"
                />
              </label>
              <label className="text-sm">
                Bearer token (optional)
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoComplete="off"
                  className="block mt-1 rounded-md border bg-background px-3 py-2 text-sm w-56"
                />
              </label>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? 'adding…' : 'add server'}
          </button>
          {err && <p className="text-sm text-rose-700">{err}</p>}
        </form>
      </section>

      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground border-b">
          <tr>
            <th className="py-2">name</th>
            <th>transport</th>
            <th>target</th>
            <th>state</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {servers.length === 0 && (
            <tr>
              <td colSpan={5} className="py-6 text-center text-muted-foreground italic">
                no MCP servers yet — add one above
              </td>
            </tr>
          )}
          {servers.map((s) => (
            <tr key={s.id} className="border-b last:border-0 align-top">
              <td className="py-2">
                {s.name}
                {s.hasAuthToken && (
                  <span className="ml-2 text-[0.7em] uppercase tracking-wide text-muted-foreground">
                    auth
                  </span>
                )}
                {testResult[s.id] && (
                  <div className="text-xs text-muted-foreground mt-1 break-all">
                    {testResult[s.id]}
                  </div>
                )}
              </td>
              <td>{s.transport}</td>
              <td className="font-mono text-xs break-all">
                {s.transport === 'stdio' ? `${s.command ?? ''} ${s.args.join(' ')}`.trim() : s.url}
              </td>
              <td>
                {s.enabled ? (
                  <span className="text-emerald-700">enabled</span>
                ) : (
                  <span className="text-muted-foreground">disabled</span>
                )}
              </td>
              <td className="space-x-2 whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => test(s.id)}
                  className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
                >
                  test
                </button>
                <button
                  type="button"
                  onClick={() => toggle(s)}
                  className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
                >
                  {s.enabled ? 'disable' : 'enable'}
                </button>
                <button
                  type="button"
                  onClick={() => remove(s.id)}
                  className="rounded-md border px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
                >
                  delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
