import type { McpServer, McpToolInfo, McpTransport } from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ConfigPage } from '../../components/ConfigPage'
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
  const [testResult, setTestResult] = useState<
    Record<string, { kind: 'pending' | 'success' | 'error'; message: string }>
  >({})
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<McpServer | null>(null)

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
    setActionBusy(s.id)
    setErr(null)
    try {
      const response = await fetch(`/api/mcp-servers/${encodeURIComponent(s.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: !s.enabled }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `Could not ${s.enabled ? 'disable' : 'enable'} server`)
      }
      await router.invalidate()
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error))
    } finally {
      setActionBusy(null)
    }
  }

  async function remove(id: string) {
    const response = await fetch(`/api/mcp-servers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    if (!response.ok && response.status !== 204) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      throw new Error(body?.error ?? 'Could not delete MCP server')
    }
    await router.invalidate()
  }

  async function test(id: string) {
    setTestResult((r) => ({ ...r, [id]: { kind: 'pending', message: 'Connecting…' } }))
    try {
      const res = await fetch(`/api/mcp-servers/${encodeURIComponent(id)}/test`, { method: 'POST' })
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        tools?: McpToolInfo[]
        error?: string
      }
      setTestResult((r) => ({
        ...r,
        [id]: res.ok && j.ok
          ? {
              kind: 'success',
              message: `${j.tools?.length ?? 0} tools: ${(j.tools ?? []).map((t) => t.name).join(', ')}`,
            }
          : { kind: 'error', message: j.error ?? `Test failed (${res.status})` },
      }))
    } catch (error) {
      setTestResult((r) => ({
        ...r,
        [id]: {
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        },
      }))
    }
  }

  return (
    <ConfigPage
      active="mcp"
      title="MCP servers"
      description={
        <>
          Expose tools from local or remote Model Context Protocol servers to every agent under
          the <code className="font-mono">mcp__&lt;server&gt;__&lt;tool&gt;</code> namespace.
          Local stdio servers inherit configured secrets; HTTP and SSE servers can use a bearer
          token.
        </>
      }
    >
      <section className="rounded-lg border bg-card p-5">
        <h3 className="font-serif text-xl mb-3">Add a server</h3>
        <form onSubmit={add} className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <label className="w-full text-sm sm:w-auto">
              Name
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="playwright"
                pattern="[a-zA-Z0-9_]+"
                className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm sm:w-48"
              />
            </label>
            <label className="w-full text-sm sm:w-auto">
              Transport
              <select
                value={transport}
                onChange={(e) => setTransport(e.target.value as McpTransport)}
                className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm"
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
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <label className="w-full text-sm sm:w-auto">
                Command
                <input
                  type="text"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx"
                  className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm sm:w-48"
                />
              </label>
              <label className="w-full min-w-0 text-sm sm:flex-1">
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
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <label className="w-full min-w-0 text-sm sm:flex-1">
                URL
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://mcp.example.com/sse"
                  className="block mt-1 rounded-md border bg-background px-3 py-2 text-sm w-full"
                />
              </label>
              <label className="w-full text-sm sm:w-auto">
                Bearer token (optional)
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoComplete="off"
                  className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm sm:w-56"
                />
              </label>
            </div>
          )}

          <Button variant="primary" type="submit" disabled={busy} className="w-full sm:w-auto">
            {busy ? 'adding…' : 'add server'}
          </Button>
          {err && <p role="alert" className="text-sm text-danger">{err}</p>}
        </form>
      </section>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
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
            {servers.map((s) => {
              const result = testResult[s.id]
              return (
                <tr key={s.id} className="border-b last:border-0 align-top">
                  <td className="py-2">
                    {s.name}
                    {s.hasAuthToken && (
                      <span className="ml-2 text-[0.7em] uppercase tracking-wide text-muted-foreground">
                        auth
                      </span>
                    )}
                  </td>
                  <td>{s.transport}</td>
                  <td className="font-mono text-xs break-all">
                    {s.transport === 'stdio'
                      ? `${s.command ?? ''} ${s.args.join(' ')}`.trim()
                      : s.url}
                  </td>
                  <td>
                    {s.enabled ? (
                      <span className="text-success">enabled</span>
                    ) : (
                      <span className="text-muted-foreground">disabled</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap">
                    <div className="flex gap-2">
                      <Button variant="ghost" className="text-xs" onClick={() => void test(s.id)}>
                        test
                      </Button>
                      <Button
                        variant="ghost"
                        className="text-xs"
                        disabled={actionBusy === s.id}
                        onClick={() => void toggle(s)}
                      >
                        {actionBusy === s.id ? 'working…' : s.enabled ? 'disable' : 'enable'}
                      </Button>
                      <Button
                        variant="danger"
                        className="text-xs"
                        disabled={actionBusy === s.id}
                        onClick={() => {
                          setErr(null)
                          setDeleteTarget(s)
                        }}
                      >
                        delete
                      </Button>
                    </div>
                    {result && (
                      <p
                        role={result.kind === 'error' ? 'alert' : 'status'}
                        className={`mt-2 max-w-72 whitespace-normal break-words text-xs ${
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
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={deleteTarget !== null}
        title={`Delete MCP server ${deleteTarget?.name ?? ''}?`}
        description={
          <p>
            This permanently removes the server configuration and its stored bearer token, closes
            the current connection, and removes its tools from future Agent turns. Reconnecting
            requires adding the server and credential again.
          </p>
        }
        confirmLabel="delete MCP server"
        onConfirm={async () => {
          if (!deleteTarget) return
          try {
            await remove(deleteTarget.id)
          } catch (error) {
            setErr(error instanceof Error ? error.message : String(error))
            throw error
          }
        }}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      />
    </ConfigPage>
  )
}
