import type { CodingEnvironmentStatus } from '@bazilion/api-types'
import { useEffect, useState } from 'react'
import { Button } from './Button'
export function CodingDefaultsCard({ teamId }: { teamId: string }) {
  const [status, setStatus] = useState<CodingEnvironmentStatus | null>(null)
  const [image, setImage] = useState('')
  const [cwd, setCwd] = useState('.')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const url = `/api/teams/${encodeURIComponent(teamId)}/coding-environment`
  useEffect(() => {
    let active = true
    fetch(url)
      .then(async (r) => {
        if (!r.ok) throw new Error('Defaults unavailable')
        return r.json()
      })
      .then((s: CodingEnvironmentStatus) => {
        if (active) {
          setStatus(s)
          setImage(s.environment?.config.image ?? s.image)
          setCwd(s.environment?.config.cwd ?? '.')
        }
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
    return () => {
      active = false
    }
  }, [url])
  return (
    <details className="border-t mt-4 pt-4">
      <summary className="cursor-pointer text-sm">Optional protected runtime defaults</summary>
      <p className="text-sm text-muted-foreground my-3">
        Agents discover commands during the task. Override the installation image only if this
        repository needs a different prepared toolchain. Host turns do not use these Docker
        defaults.
      </p>
      {error && <p role="alert">{error}</p>}
      {status && (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            setError('')
            try {
              const r = await fetch(url, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  expectedRevision: status.environment?.revision ?? 0,
                  config: { image, cwd, env: status.environment?.config.env ?? {} },
                }),
              })
              const value = await r.json()
              if (!r.ok) throw new Error(value.error)
              setStatus({ ...status, environment: value, image })
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Save failed')
            } finally {
              setBusy(false)
            }
          }}
        >
          <label className="block text-sm">
            Local Docker image
            <input
              required
              value={image}
              onChange={(e) => setImage(e.target.value)}
              className="block w-full rounded border p-2 mt-1"
            />
          </label>
          <label className="block text-sm">
            Default directory
            <input
              required
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              className="block w-full rounded border p-2 mt-1"
            />
          </label>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save defaults'}
          </Button>
        </form>
      )}
    </details>
  )
}
