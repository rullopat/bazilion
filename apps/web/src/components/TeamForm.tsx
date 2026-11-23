import type { Team } from '@bazilion/api-types'
import { type ReactNode, useState } from 'react'
import { api, errorMessage } from '../lib/api'
import { slugify, slugProblem } from '../lib/manage'
import { Button } from './Button'
import { DialogActions } from './Dialog'
import { ChoiceCards, TextField } from './ui/form'
import { Notice } from './ui/parts'

type Place = 'new' | 'link'

/** What creating a Team sends, or what is still wrong with the form. */
export function teamRequest(
  draft: { name: string; id: string; place: Place; folder: string },
  /** The ids of the Teams there are: a new one cannot take one. */
  taken: readonly string[] = [],
): {
  body: { id: string; name?: string; link?: string } | null
  problems: { id?: string; folder?: string }
} {
  const id = draft.id.trim()
  const folder = draft.folder.trim()
  const problems: { id?: string; folder?: string } = {}
  const idProblem = slugProblem(id)
  if (idProblem) problems.id = idProblem
  else if (taken.includes(id)) problems.id = 'A Team already has this ID: choose another.'
  else if (!id && draft.name.trim()) {
    problems.id = 'The name has no letters or digits to make an ID from: type one.'
  }
  if (draft.place === 'link' && folder && !folder.startsWith('/')) {
    problems.folder = 'The full path of the folder, starting with /.'
  }
  const complete = id !== '' && (draft.place === 'new' || folder !== '')
  if (!complete || problems.id || problems.folder) return { body: null, problems }
  return {
    body: {
      id,
      ...(draft.name.trim() ? { name: draft.name.trim() } : {}),
      ...(draft.place === 'link' ? { link: folder } : {}),
    },
    problems,
  }
}

/**
 * Create a Team: its name, the id made from it, and where its files are: a new folder in the
 * Bazilion home, or an existing project folder it links to.
 */
export function TeamForm({
  onCreated,
  onBusyChange,
  extraActions,
  taken = [],
}: {
  /** The ids of the Teams there are. */
  taken?: readonly string[]
  onCreated: (team: Team) => void | Promise<void>
  onBusyChange?: (busy: boolean) => void
  extraActions?: (busy: boolean) => ReactNode
}) {
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  // The id follows the name until it is typed in itself.
  const [idTouched, setIdTouched] = useState(false)
  const [place, setPlace] = useState<Place>('new')
  const [folder, setFolder] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const shownId = idTouched ? id : slugify(name)
  const request = teamRequest({ name, id: shownId, place, folder }, taken)

  function changeBusy(next: boolean) {
    setBusy(next)
    onBusyChange?.(next)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!request.body || busy) return
    setError(null)
    changeBusy(true)
    try {
      const team = await api<Team>('/api/teams', { body: request.body })
      await onCreated(team)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      changeBusy(false)
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-4">
      <div className="grid items-start gap-x-3 gap-y-4 sm:grid-cols-2">
        <TextField
          label="Name"
          value={name}
          disabled={busy}
          placeholder="My project"
          className="max-w-none"
          onChange={(value) => {
            setName(value)
            setError(null)
          }}
        />
        <TextField
          label="ID"
          value={shownId}
          disabled={busy}
          placeholder="my-project"
          mono
          className="max-w-none"
          hint="Used in commands and addresses; it cannot change later."
          problem={request.problems.id}
          onChange={(value) => {
            setIdTouched(true)
            setId(value)
            setError(null)
          }}
        />
      </div>
      <ChoiceCards
        legend="Where its files are"
        name="team-place"
        value={place}
        disabled={busy}
        options={[
          {
            value: 'new',
            label: 'A new folder',
            hint: 'Bazilion makes one for it in its home.',
          },
          {
            value: 'link',
            label: 'A project folder',
            hint: 'Its Agents work in a folder that already exists, such as a code repository.',
          },
        ]}
        onChange={setPlace}
      />
      {place === 'link' && (
        <TextField
          label="Folder"
          value={folder}
          disabled={busy}
          placeholder="/home/you/projects/my-project"
          mono
          className="max-w-none"
          hint="The Team links to it; removing the Team later removes only the link, never the folder."
          problem={request.problems.folder}
          onChange={setFolder}
        />
      )}
      {error && (
        <Notice tone="warning" role="alert" title="The Team was not created.">
          {error}
        </Notice>
      )}
      <DialogActions>
        {extraActions?.(busy)}
        <Button variant="primary" type="submit" disabled={busy || !request.body}>
          {busy ? 'Creating…' : 'Create Team'}
        </Button>
      </DialogActions>
    </form>
  )
}
