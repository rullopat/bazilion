// Single config field with inline save. Shared between the providers and
// services pages — both use the same /api/config/fields/:envVar PUT path.

import type { ServiceFieldState } from '@bazilion/api-types'
import { useRouter } from '@tanstack/react-router'
import { useId, useState } from 'react'
import { Button } from './Button'
import { ConfirmDialog } from './ConfirmDialog'

export function FieldRow({ field }: { field: ServiceFieldState }) {
  const router = useRouter()
  const inputId = useId()
  const descriptionId = `${inputId}-description`
  const [value, setValue] = useState(field.kind === 'config' ? (field.value ?? '') : '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const secretBlank = field.kind === 'secret' && value.trim().length === 0

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (secretBlank) {
      setErr(
        field.set
          ? 'Paste a replacement value, or use remove credential to explicitly clear the stored secret.'
          : 'A secret value is required.',
      )
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/config/fields/${encodeURIComponent(field.envVar)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `${res.status} ${res.statusText}`)
      }
      setSavedAt(Date.now())
      // Secret fields don't echo the value back; clear local state so the
      // input is empty (and the "set" pill updates via invalidation).
      if (field.kind === 'secret') setValue('')
      await router.invalidate()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function removeSecret() {
    const res = await fetch(`/api/config/fields/${encodeURIComponent(field.envVar)}`, {
      method: 'DELETE',
    })
    if (!res.ok && res.status !== 204) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      throw new Error(body?.error ?? `${res.status} ${res.statusText}`)
    }
    setValue('')
    setErr(null)
    setSavedAt(Date.now())
    await router.invalidate()
  }

  return (
    <form
      onSubmit={save}
      className="grid grid-cols-1 gap-2 border-b py-3 last:border-0 md:grid-cols-[12rem_minmax(0,1fr)_auto_auto] md:items-center"
    >
      <div className="min-w-0">
        <label htmlFor={inputId} className="text-sm font-medium text-foreground">
          {field.label}
        </label>
        {field.description && (
          <div id={descriptionId} className="text-xs text-muted-foreground mt-0.5">
            {field.description}
          </div>
        )}
        <details className="mt-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Advanced identifier</summary>
          <code className="mt-1 inline-block break-all font-mono">{field.envVar}</code>
        </details>
      </div>
      <div className="min-w-0">
        {field.kind === 'config' ? (
          <input
            id={inputId}
            type="text"
            aria-describedby={field.description ? descriptionId : undefined}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={field.placeholder ?? ''}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/30"
          />
        ) : (
          <>
            <input
              id={inputId}
              type="password"
              aria-describedby={field.description ? descriptionId : undefined}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={
                field.set ? '(paste to replace stored value)' : (field.placeholder ?? 'paste key…')
              }
              autoComplete="off"
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/30"
            />
            {field.set && (
              <p className="mt-1 text-xs text-muted-foreground">
                Blank keeps the current credential. Removal is a separate explicit action.
              </p>
            )}
          </>
        )}
      </div>
      <span className="text-xs">
        {field.kind === 'secret' && field.set && (
          <span
            className="rounded-full bg-success/10 text-success px-1.5 py-0.5"
            title={`preview: ${field.preview ?? ''}`}
          >
            set
          </span>
        )}
        {savedAt && Date.now() - savedAt < 2000 && (
          <span role="status" className="text-success ml-2">saved ✓</span>
        )}
      </span>
      <div className="flex flex-wrap gap-2 md:justify-self-end">
        <Button variant="ghost" type="submit" disabled={busy || secretBlank} className="text-xs">
          save
        </Button>
        {field.kind === 'secret' && field.set && (
          <Button variant="danger" className="text-xs" onClick={() => setConfirmRemove(true)}>
            remove
          </Button>
        )}
      </div>
      {err && <p role="alert" className="text-xs text-danger md:col-span-4">{err}</p>}
      <ConfirmDialog
        open={confirmRemove}
        title={`Remove ${field.label}?`}
        description={
          <p>
            This permanently deletes the stored <code className="font-mono">{field.envVar}</code>{' '}
            credential. Features that use it will fail until you save a replacement.
          </p>
        }
        confirmLabel="remove stored credential"
        onConfirm={removeSecret}
        onOpenChange={setConfirmRemove}
      />
    </form>
  )
}
