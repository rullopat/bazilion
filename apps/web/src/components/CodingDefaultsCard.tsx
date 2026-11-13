import type { CodingEnvironmentStatus, TeamCodingEnvironment } from '@bazilion/api-types'
import { useEffect, useState } from 'react'
import { api, errorMessage } from '../lib/api'
import { Button } from './Button'

/** The saved defaults for the form's two fields: an empty image means the installation's. */
export function codingDefaultsBody(image: string, cwd: string): TeamCodingEnvironment {
  return { image: image.trim() || null, cwd: cwd.trim() || '.' }
}

export function CodingDefaultsCard({ teamId }: { teamId: string }) {
  const [status, setStatus] = useState<CodingEnvironmentStatus | null>(null)
  const [image, setImage] = useState('')
  const [cwd, setCwd] = useState('.')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const url = `/api/teams/${encodeURIComponent(teamId)}/coding-environment`

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

  async function save(event: React.FormEvent) {
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

  return (
    <details>
      <summary className="cursor-pointer text-sm">Docker sandbox defaults</summary>
      <p className="my-3 text-sm text-muted-foreground">
        Image and working directory for this Team's bash commands when BAZILION_BASH_SANDBOX is
        docker
        {status ? ` (currently ${status.sandboxMode})` : ''}. The image must already exist locally;
        Bazilion never pulls it.
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {status && (
        <form className="space-y-3" onSubmit={(event) => void save(event)}>
          <label>
            Local Docker image
            <input
              value={image}
              placeholder={`${status.defaultImage} (installation default)`}
              onChange={(event) => setImage(event.target.value)}
            />
          </label>
          <label>
            Working directory inside the Team
            <input required value={cwd} onChange={(event) => setCwd(event.target.value)} />
          </label>
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save defaults'}
            </Button>
            {saved && (
              <span role="status" className="text-xs text-success">
                Saved
              </span>
            )}
          </div>
        </form>
      )}
    </details>
  )
}
