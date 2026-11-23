// The cards of the MCP page: adding a server, and the servers there are.

import type { McpServer, McpToolInfo } from '@bazilion/api-types'
import { Plus, Server } from 'lucide-react'
import { useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { EMPTY_MCP_DRAFT, type McpDraft, mcpServerForm, serversState } from '../../lib/mcp-form'
import { Button } from '../Button'
import { ConfirmDialog } from '../ConfirmDialog'
import { CheckboxRow, SecretField, SelectField, TextField } from '../ui/form'
import {
  CardBody,
  CardForm,
  CardList,
  CardRow,
  Chip,
  ListRow,
  Notice,
  SetupCard,
  Waiting,
} from '../ui/parts'

const serverPath = (id: string) => `/api/mcp-servers/${encodeURIComponent(id)}`

const TRANSPORTS = [
  { value: 'stdio', label: 'stdio' },
  { value: 'http', label: 'http' },
] as const

/** A command Bazilion starts, or an address it calls. */
export function AddServerCard({ onAdded }: { onAdded: () => Promise<void> }) {
  const [draft, setDraft] = useState<McpDraft>(EMPTY_MCP_DRAFT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const form = mcpServerForm(draft)

  const edit = (change: Partial<McpDraft>) => {
    setError(null)
    setDraft((current) => ({ ...current, ...change }))
  }

  async function add(event: React.FormEvent) {
    event.preventDefault()
    if (!form.body || busy) return
    setBusy(true)
    setError(null)
    try {
      await api('/api/mcp-servers', { body: form.body })
      // The transport stays: the next server is often of the same kind.
      setDraft({ ...EMPTY_MCP_DRAFT, transport: draft.transport })
      await onAdded()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SetupCard
      labelledBy="mcp-add"
      icon={<Plus className="size-5" />}
      title="Add a server"
      description="A stdio server is a command Bazilion starts; an http server is an address it calls."
    >
      <CardForm onSubmit={add}>
        <div className="grid items-start gap-x-3 gap-y-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <TextField
            label="Name"
            value={draft.name}
            disabled={busy}
            placeholder="playwright"
            mono
            className="max-w-none"
            problem={form.problems.name}
            onChange={(name) => edit({ name })}
          />
          <SelectField
            label="Transport"
            value={draft.transport}
            options={TRANSPORTS}
            disabled={busy}
            className="max-w-none"
            onChange={(transport) => edit({ transport })}
          />
        </div>
        {draft.transport === 'stdio' ? (
          <div className="grid items-start gap-x-3 gap-y-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <TextField
              label="Command"
              value={draft.command}
              disabled={busy}
              placeholder="npx"
              mono
              className="max-w-none"
              onChange={(command) => edit({ command })}
            />
            <TextField
              label="Args (space-separated)"
              value={draft.args}
              disabled={busy}
              placeholder="-y @modelcontextprotocol/server-filesystem /srv/data"
              mono
              className="max-w-none"
              onChange={(args) => edit({ args })}
            />
          </div>
        ) : (
          <div className="grid items-start gap-x-3 gap-y-4 sm:grid-cols-[minmax(0,1fr)_16rem]">
            <TextField
              label="URL"
              value={draft.url}
              disabled={busy}
              placeholder="https://mcp.example.com/mcp"
              mono
              inputMode="url"
              className="max-w-none"
              problem={form.problems.url}
              onChange={(url) => edit({ url })}
            />
            <SecretField
              label="Bearer token (optional)"
              saved={false}
              value={draft.token}
              disabled={busy}
              onChange={(token) => edit({ token })}
            />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button variant="primary" type="submit" disabled={busy || !form.body}>
            {busy ? 'Adding…' : 'Add server'}
          </Button>
          {error ? (
            <p
              role="alert"
              className="m-0 min-w-0 flex-1 basis-56 text-sm font-medium text-warning"
            >
              Nothing was added: {error}
            </p>
          ) : (
            form.missing && (
              <p
                role="status"
                className="m-0 min-w-0 flex-1 basis-56 text-sm font-medium text-warning"
              >
                {form.missing}
              </p>
            )
          )}
        </div>
      </CardForm>
    </SetupCard>
  )
}

type TestResult =
  | { kind: 'pending' }
  | { kind: 'success'; message: string; tools: McpToolInfo[] }
  | { kind: 'error'; message: string }

/** Which of a server's tools ask the operator before each call, as a line. */
function asksLine(server: McpServer): string {
  const choices = Object.entries(server.ask ?? {})
  const rule = 'asks you before tools that send or change something'
  if (choices.length === 0) return rule
  return `${rule}, except ${choices
    .map(([tool, asks]) => `${tool} (${asks ? 'asks' : 'never asks'})`)
    .join(', ')}`
}

/**
 * After a test: tick the tools that ask the operator before each call. What differs from the
 * default rule is saved as a choice; every other tool, one the server adds later too, keeps
 * following the rule.
 */
function AskEditor({
  server,
  tools,
  onSaved,
}: {
  server: McpServer
  tools: McpToolInfo[]
  onSaved: () => Promise<void>
}) {
  const byDefault = (tool: McpToolInfo) => tool.asksByDefault ?? false
  const [asking, setAsking] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      tools.map((tool) => [tool.name, server.ask?.[tool.name] ?? byDefault(tool)]),
    ),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save(ask: Record<string, boolean> | null) {
    setBusy(true)
    setError(null)
    try {
      await api(serverPath(server.id), { method: 'PATCH', body: { ask } })
      await onSaved()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  if (tools.length === 0) return null
  const choices = Object.fromEntries(
    tools.flatMap((tool) => {
      const asks = asking[tool.name] ?? byDefault(tool)
      return asks === byDefault(tool) ? [] : [[tool.name, asks] as const]
    }),
  )
  const unchanged = JSON.stringify(choices) === JSON.stringify(server.ask ?? {})
  return (
    <fieldset className="m-0 mt-2 grid gap-2 border-0 p-0">
      <legend className="mb-1 text-sm font-semibold text-foreground">
        Ask me before each call of
      </legend>
      {tools.map((tool) => (
        <CheckboxRow
          key={tool.name}
          label={
            <>
              <code>{tool.name}</code>
              {(asking[tool.name] ?? byDefault(tool)) !== byDefault(tool) && (
                <span className="text-xs text-muted-foreground">your choice</span>
              )}
            </>
          }
          checked={asking[tool.name] ?? byDefault(tool)}
          disabled={busy}
          onChange={(checked) => setAsking((current) => ({ ...current, [tool.name]: checked }))}
        />
      ))}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy || unchanged} onClick={() => void save(choices)}>
          Save
        </Button>
        <Button
          variant="ghost"
          disabled={busy || Object.keys(server.ask ?? {}).length === 0}
          onClick={() => void save(null)}
        >
          Back to the default
        </Button>
      </div>
      {error && (
        <Notice tone="warning" role="alert">
          {error}
        </Notice>
      )}
    </fieldset>
  )
}

/**
 * A stdio server's own variables (a token, a client id): shown by name, replaced or removed, never
 * read back. Saving one restarts the server on its next use.
 */
function VariablesEditor({ server, onSaved }: { server: McpServer; onSaved: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const names = server.envNames ?? []
  const nameProblem =
    name.trim() && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name.trim())
      ? 'Letters, digits and underscores, not starting with a digit.'
      : undefined
  async function change(env: Record<string, string | null>) {
    setBusy(true)
    setError(null)
    try {
      await api(serverPath(server.id), { method: 'PATCH', body: { env } })
      setName('')
      setValue('')
      await onSaved()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-2 grid gap-3">
      {names.length > 0 ? (
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {names.map((envName) => (
            <li key={envName} className="flex items-center justify-between gap-3 text-sm">
              <code>{envName}</code>
              <Button
                variant="ghost"
                disabled={busy}
                aria-label={`Remove ${envName} from ${server.name}`}
                onClick={() => void change({ [envName]: null })}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-sm text-muted-foreground">No variables of its own.</p>
      )}
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (name.trim() && value && !nameProblem) void change({ [name.trim()]: value })
        }}
      >
        <TextField
          label="Variable"
          value={name}
          mono
          disabled={busy}
          placeholder="NOTION_TOKEN"
          hint="A name it already has gets the new value."
          problem={nameProblem}
          className="max-w-none"
          onChange={setName}
        />
        <SecretField
          label="Value"
          saved={false}
          value={value}
          disabled={busy}
          hint="Stored encrypted and given to this server only."
          onChange={setValue}
        />
        <div>
          <Button
            variant="primary"
            type="submit"
            disabled={busy || !name.trim() || !value || nameProblem !== undefined}
          >
            {busy ? 'Saving…' : 'Save the variable'}
          </Button>
        </div>
      </form>
      {error && (
        <Notice tone="warning" role="alert">
          {error}
        </Notice>
      )}
    </div>
  )
}

/** The servers whose tools are offered to every Agent turn while they are switched on. */
export function ServersCard({
  servers,
  onChanged,
}: {
  servers: McpServer[]
  onChanged: () => Promise<void>
}) {
  const [tests, setTests] = useState<Record<string, TestResult>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [variablesOf, setVariablesOf] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<McpServer | null>(null)
  const state = serversState(servers)

  async function toggle(server: McpServer) {
    setBusyId(server.id)
    setError(null)
    try {
      await api(serverPath(server.id), { method: 'PATCH', body: { enabled: !server.enabled } })
      await onChanged()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusyId(null)
    }
  }

  async function test(id: string) {
    setTests((current) => ({ ...current, [id]: { kind: 'pending' } }))
    let result: TestResult
    try {
      const body = await api<{ ok: boolean; tools?: McpToolInfo[]; error?: string }>(
        `${serverPath(id)}/test`,
        { method: 'POST' },
      )
      const tools = body.tools ?? []
      result = body.ok
        ? {
            kind: 'success',
            message: `${tools.length === 1 ? '1 tool' : `${tools.length} tools`}: ${tools.map((tool) => tool.name).join(', ')}`,
            tools,
          }
        : { kind: 'error', message: body.error ?? 'Test failed' }
    } catch (cause) {
      result = { kind: 'error', message: errorMessage(cause) }
    }
    setTests((current) => ({ ...current, [id]: result }))
  }

  return (
    <SetupCard
      labelledBy="mcp-servers"
      icon={<Server className="size-5" />}
      title="Servers"
      description="Their tools are offered to every Agent turn while they are switched on."
      action={state && <Chip tone={state.tone}>{state.label}</Chip>}
    >
      {servers.length === 0 ? (
        <CardRow className="py-4 text-sm text-muted-foreground">
          No MCP servers yet; add one above.
        </CardRow>
      ) : (
        <CardList>
          {servers.map((server) => {
            const result = tests[server.id]
            const busy = busyId === server.id
            return (
              <ListRow
                key={server.id}
                title={server.name}
                chip={
                  <Chip tone={server.enabled ? 'success' : 'neutral'}>
                    {server.enabled ? 'Enabled' : 'Disabled'}
                  </Chip>
                }
                meta={
                  <>
                    <span>{server.transport}</span>
                    {server.hasAuthToken && <span>bearer token</span>}
                    {server.envNames && server.envNames.length > 0 && (
                      <span>variables: {server.envNames.join(', ')}</span>
                    )}
                    <span>{asksLine(server)}</span>
                    <code className="break-all">
                      {server.transport === 'stdio'
                        ? `${server.command ?? ''} ${server.args.join(' ')}`.trim()
                        : server.url}
                    </code>
                  </>
                }
                actions={
                  <>
                    <Button
                      variant="ghost"
                      disabled={result?.kind === 'pending'}
                      aria-label={`Test ${server.name}`}
                      onClick={() => void test(server.id)}
                    >
                      Test
                    </Button>
                    {server.transport === 'stdio' && (
                      <Button
                        variant="ghost"
                        aria-expanded={variablesOf === server.id}
                        aria-label={`Variables of ${server.name}`}
                        onClick={() =>
                          setVariablesOf((current) => (current === server.id ? null : server.id))
                        }
                      >
                        Variables
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      disabled={busy}
                      aria-label={`${server.enabled ? 'Disable' : 'Enable'} ${server.name}`}
                      onClick={() => void toggle(server)}
                    >
                      {busy ? 'Working…' : server.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      variant="danger"
                      disabled={busy}
                      aria-label={`Delete ${server.name}`}
                      onClick={() => setDeleting(server)}
                    >
                      Delete
                    </Button>
                  </>
                }
              >
                {variablesOf === server.id && (
                  <VariablesEditor server={server} onSaved={onChanged} />
                )}
                {result?.kind === 'pending' && <Waiting>Connecting…</Waiting>}
                {result?.kind === 'success' && (
                  <>
                    <Notice tone="success">{result.message}</Notice>
                    <AskEditor
                      key={JSON.stringify(server.ask ?? {})}
                      server={server}
                      tools={result.tools}
                      onSaved={onChanged}
                    />
                  </>
                )}
                {result?.kind === 'error' && (
                  <Notice tone="warning" role="alert">
                    {result.message}
                  </Notice>
                )}
              </ListRow>
            )
          })}
        </CardList>
      )}
      {error && (
        <CardBody>
          <Notice tone="warning" role="alert" title="That did not work.">
            {error}
          </Notice>
        </CardBody>
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={`Delete MCP server ${deleting?.name ?? ''}?`}
        description={
          <p className="m-0">
            This removes the server with its stored bearer token and variables, closes its
            connection and removes its tools from later Agent turns.
          </p>
        }
        confirmLabel="Delete MCP server"
        onConfirm={async () => {
          if (!deleting) return
          await api(serverPath(deleting.id), { method: 'DELETE' })
          await onChanged()
        }}
      />
    </SetupCard>
  )
}
