// An Agent's secrets (BAZ-090): what it asked for with secret_request, or what you gave it here.
// Its commands get each as an environment variable, web_fetch only for the hosts listed. Values
// are never shown; a secret is replaced or removed.

import type {
  Agent,
  AgentSecret,
  ListAgentSecretsResponse,
  SetAgentSecretRequest,
} from '@bazilion/api-types'
import { KeyRound, Plus } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { useHydrated, useResource } from '../../lib/use-resource'
import { Button } from '../Button'
import { ConfirmDialog } from '../ConfirmDialog'
import { Dialog } from '../Dialog'
import { SecretField, TextField } from '../ui/form'
import { CardEmpty, CardList, Chip, ListRow, Notice, RowMenu, SetupCard } from '../ui/parts'

const NAME = /^[A-Z_][A-Z0-9_]*$/

export function AgentSecrets({ agent }: { agent: Agent }) {
  const path = `/api/agents/${encodeURIComponent(agent.id)}/secrets`
  const data = useResource((signal) => api<ListAgentSecretsResponse>(path, { signal }), [path])
  if (!data.data) {
    return data.error ? (
      <Notice role="alert" title="The secrets could not be loaded.">
        {data.error}
      </Notice>
    ) : (
      <p role="status" className="m-0 text-sm text-muted-foreground">
        Loading the secrets…
      </p>
    )
  }
  return (
    <SecretsView
      agentId={agent.id}
      agentName={agent.name}
      secrets={data.data.secrets}
      onChanged={data.reload}
    />
  )
}

/** The secrets as loaded. */
export function SecretsView({
  agentId,
  agentName,
  secrets,
  onChanged,
}: {
  agentId: string
  agentName: string
  secrets: AgentSecret[]
  onChanged: () => Promise<void>
}) {
  const [editing, setEditing] = useState<AgentSecret | 'new' | null>(null)
  const [removing, setRemoving] = useState<AgentSecret | null>(null)
  const hydrated = useHydrated()
  const base = `/api/agents/${encodeURIComponent(agentId)}/secrets`
  const add = (
    <Button variant="primary" onClick={() => setEditing('new')}>
      <Plus className="size-4" aria-hidden="true" />
      Add a secret
    </Button>
  )
  return (
    <div className="grid gap-5">
      <SetupCard
        labelledBy="agent-secrets"
        icon={<KeyRound className="size-5" />}
        title="Secrets"
        description={`${agentName}'s commands get each one as an environment variable, and web pages it fetches only from the hosts listed. ${agentName} never sees the values.`}
        action={secrets.length > 0 && add}
      >
        {secrets.length === 0 ? (
          <CardEmpty icon={<KeyRound className="size-5" />} title="No secrets yet" action={add}>
            When {agentName} needs an API token, it asks for it in the chat. You can also give one
            here.
          </CardEmpty>
        ) : (
          <CardList>
            {secrets.map((secret) => (
              <ListRow
                key={secret.name}
                inline
                title={<code className="font-mono text-[0.92em]">{secret.name}</code>}
                chip={
                  <Chip tone="neutral">
                    {secret.hosts.length > 0 ? secret.hosts.join(', ') : 'Commands only'}
                  </Chip>
                }
                meta={hydrated && <span>Stored {new Date(secret.storedAt).toLocaleString()}</span>}
                actions={
                  <RowMenu
                    label={`More for ${secret.name}`}
                    items={[
                      { label: 'Replace…', onSelect: () => setEditing(secret) },
                      { label: 'Remove…', danger: true, onSelect: () => setRemoving(secret) },
                    ]}
                  />
                }
              >
                {secret.reason && (
                  <p className="m-0 break-words text-sm text-mocha">{secret.reason}</p>
                )}
              </ListRow>
            ))}
          </CardList>
        )}
      </SetupCard>

      {editing && (
        <SecretDialog
          base={base}
          agentName={agentName}
          {...(editing !== 'new' ? { existing: editing } : {})}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await onChanged()
          }}
        />
      )}

      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.name ?? 'this secret'}?`}
        description={
          <p className="m-0">
            {agentName}'s commands no longer get it from the next turn on. It is deleted, not kept.
          </p>
        }
        confirmLabel="Remove the secret"
        onConfirm={async () => {
          if (!removing) return
          await api(`${base}/${encodeURIComponent(removing.name)}`, { method: 'DELETE' })
          await onChanged()
        }}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
      />
    </div>
  )
}

/** Give a new secret, or replace one (`existing`) with a new value and hosts. */
function SecretDialog({
  base,
  agentName,
  existing,
  onClose,
  onSaved,
}: {
  base: string
  agentName: string
  existing?: AgentSecret
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [name, setName] = useState(existing?.name ?? '')
  const [value, setValue] = useState('')
  const [hosts, setHosts] = useState(existing?.hosts.join(', ') ?? '')
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameProblem = NAME.test(name.trim())
    ? undefined
    : 'Capital letters, digits and underscores, such as GITHUB_TOKEN.'
  const valueProblem = value.trim() ? undefined : 'Paste the value.'

  async function submit(event: FormEvent) {
    event.preventDefault()
    setTried(true)
    if (nameProblem || valueProblem) return
    setBusy(true)
    const body: SetAgentSecretRequest = {
      value,
      hosts: hosts
        .split(/[\s,]+/)
        .map((host) => host.trim())
        .filter(Boolean),
    }
    try {
      await api(`${base}/${encodeURIComponent(name.trim())}`, { method: 'PUT', body })
      setValue('')
      await onSaved()
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={existing ? `Replace ${existing.name}` : 'Add a secret'}
      description={`${agentName} never sees the value: its commands get it by name.`}
      busy={busy}
      onClose={onClose}
    >
      <form onSubmit={(event) => void submit(event)} className="grid gap-4">
        {!existing && (
          <TextField
            label="Name"
            value={name}
            mono
            placeholder="GITHUB_TOKEN"
            disabled={busy}
            problem={tried ? nameProblem : undefined}
            onChange={(next) => setName(next.toUpperCase())}
          />
        )}
        <SecretField
          label="Value"
          saved={false}
          value={value}
          disabled={busy}
          placeholder="Paste the secret"
          {...(tried && valueProblem ? { notes: valueProblem } : {})}
          onChange={setValue}
        />
        <TextField
          label="Hosts web_fetch may send it to"
          value={hosts}
          mono
          placeholder="api.github.com"
          disabled={busy}
          hint="Comma-separated. Leave empty for commands only."
          onChange={setHosts}
        />
        {error && (
          <Notice role="alert" title="The secret was not stored.">
            {error}
          </Notice>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? 'Storing…' : existing ? 'Replace the secret' : 'Store the secret'}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
