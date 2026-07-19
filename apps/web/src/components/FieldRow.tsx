// Single config field with inline save. Shared between the providers and
// services pages — both use the same /api/config/fields/:envVar PUT path.

import type { ServiceFieldState } from '@bazilion/api-types'
import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'

export function FieldRow({ field }: { field: ServiceFieldState }) {
  const router = useRouter()
  const [value, setValue] = useState(field.kind === 'config' ? (field.value ?? '') : '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault()
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

  return (
    <form
      onSubmit={save}
      className="grid grid-cols-1 gap-2 border-b py-3 last:border-0 md:grid-cols-[12rem_minmax(0,1fr)_auto_auto] md:items-center"
    >
      <div className="min-w-0">
        <div className="text-sm">{field.label}</div>
        <div className="font-mono text-xs text-muted-foreground">{field.envVar}</div>
        {field.description && (
          <div className="text-xs text-muted-foreground mt-0.5">{field.description}</div>
        )}
      </div>
      {field.kind === 'config' ? (
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={field.placeholder ?? ''}
          className="rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/30"
        />
      ) : (
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={field.set ? '(replace — blank clears)' : (field.placeholder ?? 'paste key…')}
          autoComplete="off"
          className="rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/30"
        />
      )}
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
          <span className="text-success ml-2">saved ✓</span>
        )}
      </span>
      <button
        type="submit"
        disabled={busy}
        className="unstyled justify-self-start rounded-md border bg-background px-2 py-1.5 text-xs text-foreground hover:bg-accent disabled:opacity-50 md:justify-self-auto"
      >
        save
      </button>
      {err && <p className="text-xs text-danger md:col-span-4">{err}</p>}
    </form>
  )
}
