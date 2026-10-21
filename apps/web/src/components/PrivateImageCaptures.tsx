import type { PrivateImageCapture, PrivateImageCaptureListResponse, PrivateImageRecoveryResponse } from '@bazilion/api-types'
import { useEffect, useState } from 'react'
import { Button } from './Button'
import { ConfirmDialog } from './ConfirmDialog'

export function PrivateImageCaptures({ teamId, agentId, onReleased }: {
  teamId: string
  agentId?: string
  onReleased: () => void
}) {
  const [page, setPage] = useState<PrivateImageCaptureListResponse | null>(null)
  const [offset, setOffset] = useState(0)
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [discarding, setDiscarding] = useState<PrivateImageCapture | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ teamId, limit: '20', offset: String(offset) })
    if (agentId) query.set('agentId', agentId)
    setPage(null)
    setError('')
    fetch(`/api/results/private-images?${query}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load private image inventory.')
        const value = await response.json() as PrivateImageCaptureListResponse
        if (controller.signal.aborted) return
        if (offset > 0 && offset >= value.total) {
          setOffset(Math.max(0, Math.floor((value.total - 1) / 20) * 20))
          return
        }
        setPage(value)
      })
      .catch((err) => { if (!controller.signal.aborted) setError(String(err.message)) })
    return () => controller.abort()
  }, [teamId, agentId, offset, revision])

  async function action(id: string, kind: 'recover' | 'discard') {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      let response: Response
      try {
        response = await fetch(`/api/results/private-images/${encodeURIComponent(id)}/${kind}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ teamId, ...(kind === 'discard' ? { confirm: true } : {}) }),
        })
      } catch {
        throw new Error('Outcome unknown. Refresh inventory and approvals before deciding whether to try again.')
      }
      if (!response.ok) throw new Error('Capture unavailable or active. Refresh inventory and settle its producer/delivery first.')
      if (kind === 'recover') {
        const value: unknown = await response.json().catch(() => null)
        if (!value || typeof value !== 'object' || !('resultId' in value) || value.resultId !== id ||
          !('status' in value) || !['released', 'already_released', 'approval_required', 'blocked'].includes(String(value.status)))
          throw new Error('Outcome unknown. Refresh inventory and approvals before deciding whether to try again.')
        const result = value as PrivateImageRecoveryResponse
        if (result.status === 'approval_required') {
          setMessage(`Image remains private. Approval required: ${result.approvalId}`)
        } else if (result.status === 'blocked') {
          setMessage(`Recovery blocked: ${result.reason}${result.approvalStatus ? ` (${result.approvalStatus})` : ''}. No generation was requested.`)
        } else {
          setMessage('Image is available in saved Results below. No generation was requested.')
          onReleased()
        }
      } else {
        setMessage('Private bytes discarded; the deletion receipt prevents regeneration.')
      }
      setRevision((value) => value + 1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Retained private images" className="my-5 rounded-lg border border-fawn p-4">
      <h2>Retained private images</h2>
      <p>These captures survived without authorized delivery. Inventory shows IDs, producer, time and size only—not image contents. Recovery follows current Team Policy; it never generates again.</p>
      <Button variant="ghost" disabled={busy} onClick={() => setRevision((value) => value + 1)}>Refresh private inventory</Button>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message} <a href="/approvals">Open approvals</a></p>}
      {!page && !error && <p role="status">Loading private inventory…</p>}
      {page && <>
        <p>{page.total} private captures in selection ({page.privateBytes} bytes). Home Results quota used: {page.retainedBytes} / {1024 ** 3} bytes.</p>
        <ul>
          {page.captures.map((capture) => <li key={capture.id} className="my-3 break-all">
            <p>Capture: {capture.id} · Agent: {capture.agentId} · {capture.byteLength} bytes · {new Date(capture.createdAt).toLocaleString()}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" disabled={busy} onClick={() => { void action(capture.id, 'recover').catch((err) => setError(err.message)) }}>Recover through Team Policy</Button>
              <Button variant="danger" disabled={busy} onClick={() => setDiscarding(capture)}>Discard private image</Button>
            </div>
          </li>)}
        </ul>
        <div className="flex flex-wrap items-center gap-3" aria-label="Private images pagination">
          <Button variant="ghost" disabled={busy || offset === 0} onClick={() => setOffset((value) => Math.max(0, value - 20))}>Previous private page</Button>
          <span>{page.total ? `${offset + 1}–${offset + page.captures.length} of ${page.total}` : '0 private captures'}</span>
          <Button variant="ghost" disabled={busy || offset + 20 >= page.total} onClick={() => setOffset((value) => value + 20)}>Next private page</Button>
        </div>
      </>}
      <ConfirmDialog open={discarding !== null} title="Discard private image?"
        description={`Permanently delete private bytes for capture ${discarding?.id ?? ''}. This does not disclose the image or request another generation. Active producers and live delivery holds must settle first.`}
        confirmLabel="Permanently discard" onOpenChange={(open) => { if (!open) setDiscarding(null) }}
        onConfirm={async () => { if (discarding) await action(discarding.id, 'discard') }} />
    </section>
  )
}
