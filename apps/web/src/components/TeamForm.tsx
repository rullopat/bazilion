import type { Team } from '@bazilion/api-types'
import { type ReactNode, useState } from 'react'
import { api, errorMessage } from '../lib/api'
import { Button } from './Button'

/**
 * Register a Team: a slug, an optional name and an optional absolute path the slot links to
 * (empty creates a fresh directory under ~/.bazilion/teams/<slug>/).
 */
export function TeamForm({
  onCreated,
  onBusyChange,
  extraActions,
}: {
  onCreated: (team: Team) => void | Promise<void>
  onBusyChange?: (busy: boolean) => void
  extraActions?: (busy: boolean) => ReactNode
}) {
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function changeBusy(next: boolean) {
    setBusy(next)
    onBusyChange?.(next)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    changeBusy(true)
    try {
      const team = await api<Team>('/api/teams', {
        body: { id: id.trim(), name: name.trim() || undefined, link: link.trim() || undefined },
      })
      setId('')
      setName('')
      setLink('')
      await onCreated(team)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      changeBusy(false)
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <label>
          ID (slug)
          <input
            value={id}
            onChange={(event) => setId(event.target.value)}
            required
            pattern="[a-z0-9][a-z0-9\-]*"
            placeholder="my-project"
          />
        </label>
        <label>
          Name (optional)
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="My project"
          />
        </label>
        <label className="sm:col-span-2">
          Link target (optional, absolute path)
          <input
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="/home/you/projects/my-project"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            Leave blank for a fresh directory under <code>~/.bazilion/teams/&lt;slug&gt;/</code>.
            Give a path to link the Team to an existing project tree.
          </span>
        </label>
      </div>
      {error && (
        <p role="alert" className="err mt-2">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {extraActions?.(busy)}
        <Button variant="primary" type="submit" disabled={busy || !id.trim()}>
          {busy ? 'Creating…' : 'Create team'}
        </Button>
      </div>
    </form>
  )
}
