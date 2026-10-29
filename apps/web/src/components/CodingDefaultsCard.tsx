import type { CodingEnvironmentStatus } from '@bazilion/api-types'
import { useEffect, useState } from 'react'
import { Button } from './Button'
import { codingDefaultsRequest } from '../lib/coding-defaults'
export function CodingDefaultsCard({ teamId }: { teamId: string }) {
  const [status, setStatus] = useState<CodingEnvironmentStatus | null>(null)
  const [backend, setBackend] = useState<'native' | 'docker'>('native')
  const [image, setImage] = useState('')
  const [cwd, setCwd] = useState('.')
  const [ci, setCi] = useState('')
  const [noColor, setNoColor] = useState('')
  const [tz, setTz] = useState('')
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
          const config = s.environment?.config
          setStatus(s)
          setBackend(config?.backend ?? (s.configuredExecution === 'docker' ? 'docker' : 'native'))
          setImage(config?.backend === 'docker' ? config.image : (s.image ?? 'debian:bookworm-slim'))
          setCwd(config?.cwd ?? '.')
          setCi(config?.env.CI ?? '')
          setNoColor(config?.env.NO_COLOR ?? '')
          setTz(config?.env.TZ ?? '')
        }
      })
      .catch((e) => { if (active) setError(e.message) })
    return () => { active = false }
  }, [url])
  return (
    <details className="border-t mt-4 pt-4">
      <summary className="cursor-pointer text-sm">Optional protected runtime defaults</summary>
      <p className="text-sm text-muted-foreground my-3">
        Defaults do not activate protection or prove runtime availability. Native defaults have no
        image; Docker defaults name an explicitly prepared local image. A mismatched backend refuses
        execution, never switches to host or another sandbox. Host turns remain unisolated.
      </p>
      {error && <p role="alert">{error}</p>}
      {status?.supportedBackends?.length === 0 && <p role="status" className="text-sm text-muted-foreground my-3">No qualified isolation backend is available on this platform. Native macOS isolation is deferred and unqualified. Trusted host execution is unisolated and does not activate these defaults; saved backend choices are not converted.</p>}
      {status && (
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault()
          if (status.supportedBackends && !status.supportedBackends.includes(backend)) {
            setError('This backend is unavailable; protected execution cannot use trusted host mode.')
            return
          }
          setBusy(true)
          setError('')
          try {
            const request = codingDefaultsRequest({backend,image,cwd,ci,noColor,tz},status.environment?.revision??0)
            const r = await fetch(url, {
              method: 'PUT', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(request),
            })
            const value = await r.json()
            if (!r.ok) throw new Error(value.error)
            setStatus({ ...status, environment: value, image: backend === 'docker' ? image : null })
          } catch (e) { setError(e instanceof Error ? e.message : 'Save failed') }
          finally { setBusy(false) }
        }}>
          <label className="block text-sm">Defaults backend
            <select className="block w-full rounded border p-2 mt-1" value={backend} onChange={e => setBackend(e.target.value as 'native' | 'docker')}>
              {(status.supportedBackends??['native','docker']).includes('native') && <option value="native">Native OS sandbox (Linux)</option>}
              {backend==='native' && status.supportedBackends && !status.supportedBackends.includes('native') && <option value="native" disabled>Native isolation — unavailable/unqualified</option>}
              {(status.supportedBackends??['native','docker']).includes('docker') && <option value="docker">Docker (Linux)</option>}
              {backend==='docker' && status.supportedBackends && !status.supportedBackends.includes('docker') && <option value="docker" disabled>Saved Docker backend unavailable on this platform</option>}
            </select>
          </label>
          {backend === 'docker' && (status.supportedBackends??['native','docker']).includes('docker') && <label className="block text-sm">Local Docker image
            <input required value={image} onChange={e => setImage(e.target.value)} className="block w-full rounded border p-2 mt-1" />
          </label>}
          <label className="block text-sm">Default directory
            <input required value={cwd} onChange={e => setCwd(e.target.value)} className="block w-full rounded border p-2 mt-1" />
          </label>
          <label className="block text-sm">CI
            <select value={ci} onChange={e => setCi(e.target.value)}><option value="">Unset</option><option value="true">true</option><option value="false">false</option></select>
          </label>
          <label className="block text-sm">NO_COLOR
            <select value={noColor} onChange={e => setNoColor(e.target.value)}><option value="">Unset</option><option value="0">0</option><option value="1">1</option></select>
          </label>
          <label className="block text-sm">TZ
            <select value={tz} onChange={e => setTz(e.target.value)}><option value="">Unset</option><option value="UTC">UTC</option></select>
          </label>
          <Button type="submit" variant="primary" disabled={busy || !!status.supportedBackends && !status.supportedBackends.includes(backend)}>{busy ? 'Saving…' : 'Save defaults'}</Button>
        </form>
      )}
    </details>
  )
}
