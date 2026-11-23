// Common connections on the MCP page: Microsoft 365, Google Workspace, Slack and Notion, each a
// third-party MCP server run on this computer. Connecting one asks only for what it needs; its
// tools that send or change something ask the operator before each call.

import {
  MCP_PRESETS,
  type McpPreset,
  type McpServer,
  type McpServerInput,
  presetServer,
} from '@bazilion/api-types'
import { ExternalLink, PlugZap } from 'lucide-react'
import { useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { Button } from '../Button'
import { Dialog, DialogActions } from '../Dialog'
import { CheckboxRow, SecretField, TextField } from '../ui/form'
import { CardList, Chip, ListRow, Notice, SetupCard } from '../ui/parts'

/** A server made from this preset: the same command and package. */
function madeFrom(preset: McpPreset, server: McpServer): boolean {
  const pkg = preset.args.find((arg) => !arg.startsWith('-'))
  return server.command === preset.command && pkg !== undefined && server.args.includes(pkg)
}

export function CommonConnectionsCard({
  servers,
  onAdded,
}: {
  servers: McpServer[]
  onAdded: () => Promise<void>
}) {
  const [open, setOpen] = useState<McpPreset | null>(null)
  return (
    <SetupCard
      labelledBy="mcp-common"
      icon={<PlugZap className="size-5" />}
      title="Common connections"
      description="Mail, calendars, chat and notes your Agents can work in. Each is a third-party MCP server that runs on this computer; its tools that send or change something ask you first."
    >
      <CardList>
        {MCP_PRESETS.map((preset) => {
          const added = servers.find((server) => madeFrom(preset, server))
          return (
            <ListRow
              key={preset.id}
              title={preset.title}
              chip={added && <Chip tone="success">Added as {added.name}</Chip>}
              meta={<span>{preset.does}</span>}
              actions={
                <Button
                  variant={added ? 'ghost' : 'primary'}
                  aria-label={`Connect ${preset.title}`}
                  onClick={() => setOpen(preset)}
                >
                  {added ? 'Add another' : 'Connect'}
                </Button>
              }
            />
          )
        })}
      </CardList>
      {open && (
        <PresetDialog
          preset={open}
          taken={servers.map((server) => server.name)}
          onClose={() => setOpen(null)}
          onAdded={async () => {
            setOpen(null)
            await onAdded()
          }}
        />
      )}
    </SetupCard>
  )
}

function PresetDialog({
  preset,
  taken,
  onClose,
  onAdded,
}: {
  preset: McpPreset
  taken: string[]
  onClose: () => void
  onAdded: () => Promise<void>
}) {
  const [name, setName] = useState(taken.includes(preset.id) ? `${preset.id}_2` : preset.id)
  const [values, setValues] = useState<Record<string, string>>({})
  const [chosen, setChosen] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const made = presetServer(preset, { name, chosen, values })
  const nameProblem = !/^[a-zA-Z0-9_]+$/.test(name.trim())
    ? 'Letters, digits and underscores only: its tools are named after it.'
    : taken.includes(name.trim())
      ? 'A server already has this name.'
      : undefined
  const missing = preset.fields.filter((field) => !values[field.name]?.trim())

  async function add(event: React.FormEvent) {
    event.preventDefault()
    if (nameProblem || missing.length > 0) return
    setBusy(true)
    setError(null)
    try {
      const body: McpServerInput = {
        name: made.name,
        transport: 'stdio',
        command: made.command,
        args: made.args,
        env: made.env,
      }
      await api('/api/mcp-servers', { body })
      await onAdded()
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={`Connect ${preset.title}`}
      description={preset.does}
      busy={busy}
      onClose={onClose}
    >
      <form onSubmit={(event) => void add(event)} className="grid gap-4">
        <p className="m-0 text-sm text-mocha">{preset.signIn}</p>
        {preset.needs && (
          <p className="m-0 text-sm text-mocha">
            Needs on this computer: <strong className="text-foreground">{preset.needs}</strong>
          </p>
        )}
        {preset.caveat && <Notice tone="warning">{preset.caveat}</Notice>}
        {preset.fields.map((field) =>
          field.secret ? (
            <SecretField
              key={field.name}
              label={field.label}
              saved={false}
              value={values[field.name] ?? ''}
              hint={field.hint}
              disabled={busy}
              onChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))}
            />
          ) : (
            <TextField
              key={field.name}
              label={field.label}
              value={values[field.name] ?? ''}
              hint={field.hint}
              mono
              disabled={busy}
              className="max-w-none"
              onChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))}
            />
          ),
        )}
        {preset.options.map((option) => (
          <div key={option.id}>
            <CheckboxRow
              label={option.label}
              checked={chosen.includes(option.id)}
              disabled={busy}
              onChange={(checked) =>
                setChosen((current) =>
                  checked ? [...current, option.id] : current.filter((id) => id !== option.id),
                )
              }
            />
            <p className="m-0 mt-1 pl-7 text-xs text-muted-foreground">{option.hint}</p>
          </div>
        ))}
        <TextField
          label="Name"
          value={name}
          mono
          disabled={busy}
          hint="Its tools are named mcp__<name>__<tool>."
          problem={nameProblem}
          className="max-w-none"
          onChange={setName}
        />
        <p className="m-0 text-xs text-muted-foreground">
          It runs <code>{[made.command, ...made.args].join(' ')}</code>.{' '}
          <a
            href={preset.guide}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5"
          >
            Its guide
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        </p>
        {error && (
          <Notice tone="warning" role="alert" title="It was not added.">
            {error}
          </Notice>
        )}
        <DialogActions>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={busy || nameProblem !== undefined || missing.length > 0}
          >
            {busy ? 'Adding…' : `Add ${preset.title}`}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
