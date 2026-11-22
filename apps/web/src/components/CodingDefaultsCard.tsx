// A Team's defaults for commands run in Docker: the image and the folder they start in.

import type { CodingEnvironmentStatus, TeamCodingEnvironment } from '@bazilion/api-types'
import { type FormEvent, useEffect, useState } from 'react'
import { api, errorMessage } from '../lib/api'
import { SaveBar, saveStatus, TextField } from './ui/form'
import { CardForm, Notice } from './ui/parts'

/** The saved defaults for the form's two fields: an empty image means the installation's. */
export function codingDefaultsBody(image: string, cwd: string): TeamCodingEnvironment {
  return { image: image.trim() || null, cwd: cwd.trim() || '.' }
}

/** The form, as the body of a card: it comes after the card's own facts. */
export function CodingDefaultsCard({ teamId }: { teamId: string }) {
  const [status, setStatus] = useState<CodingEnvironmentStatus | null>(null)
  const [image, setImage] = useState('')
  const [cwd, setCwd] = useState('.')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const url = `/api/teams/${encodeURIComponent(teamId)}/coding-environment`
  const dirty = status !== null && (image !== (status.image ?? '') || cwd !== status.cwd)

  function show(next: CodingEnvironmentStatus) {
    setStatus(next)
    setImage(next.image ?? '')
    setCwd(next.cwd)
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: show only calls state setters.
  useEffect(() => {
    const controller = new AbortController()
    api<CodingEnvironmentStatus>(url, { signal: controller.signal })
      .then(show)
      .catch((cause) => {
        if (!controller.signal.aborted) setError(errorMessage(cause))
      })
    return () => controller.abort()
  }, [url])

  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      show(
        await api<CodingEnvironmentStatus>(url, {
          method: 'PUT',
          body: codingDefaultsBody(image, cwd),
        }),
      )
      setSaved(true)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  if (!status) {
    return error ? (
      <div className="border-t border-border px-4 py-4 sm:px-5">
        <Notice role="alert" title="The Docker defaults could not be loaded.">
          {error}
        </Notice>
      </div>
    ) : null
  }
  return (
    <CardForm onSubmit={(event) => void save(event)}>
      <div>
        <h3 className="m-0 font-body text-sm font-semibold text-foreground">Commands in Docker</h3>
        <p className="m-0 text-sm text-muted-foreground">
          {status.sandboxMode === 'docker'
            ? 'Commands run in Docker now. '
            : 'Commands run on this computer now; these apply once Setup → Tools runs them in Docker. '}
          The image must already be on this computer: Bazilion never downloads one.
        </p>
      </div>
      <div className="grid items-start gap-x-3 gap-y-4 sm:grid-cols-2">
        <TextField
          label="Image"
          value={image}
          mono
          disabled={busy}
          placeholder={status.defaultImage}
          hint="Empty: the installation’s own."
          className="max-w-none"
          onChange={(value) => {
            setImage(value)
            setSaved(false)
          }}
        />
        <TextField
          label="Folder they start in"
          value={cwd}
          mono
          disabled={busy}
          hint="Inside the Team’s folder; “.” is the folder itself."
          className="max-w-none"
          onChange={(value) => {
            setCwd(value)
            setSaved(false)
          }}
        />
      </div>
      <SaveBar
        busy={busy}
        disabled={!dirty}
        status={saveStatus({ error: error || null, dirty, saved })}
      />
    </CardForm>
  )
}
