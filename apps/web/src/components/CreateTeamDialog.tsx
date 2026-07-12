// Quick-create a team from the sidebar's spawn dropdown. POSTs to
// /api/teams with the current shape: { id, name?, link? }. The daemon
// puts the slot under ~/.bazilion/teams/<slug>/ — a fresh directory by
// default, or a symlink to `link` if provided.

import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'

interface Props {
  onClose: () => void
}

export function CreateTeamDialog({ onClose }: Props) {
  const router = useRouter()
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    if (!id.trim()) {
      setErr('id is required')
      return
    }
    setBusy(true)
    try {
      const body: Record<string, unknown> = { id: id.trim() }
      if (name.trim()) body.name = name.trim()
      if (link.trim()) body.link = link.trim()
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(e.error ?? `${res.status} ${res.statusText}`)
      }
      onClose()
      await router.invalidate()
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click-to-close is augmentative
    // biome-ignore lint/a11y/useKeyWithClickEvents: ditto
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px]"
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-lg"
      >
        <h3 className="font-serif text-xl text-foreground mb-1">Create a new team</h3>
        <p className="text-sm text-muted-foreground mb-4">
          A team is a collaboration context — one filesystem root, one USER.md, one roster. The
          slot lives at <code className="font-mono">~/.bazilion/teams/&lt;slug&gt;/</code>.
        </p>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <label className="block text-sm">
            ID (slug)
            <input
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value)}
              required
              pattern="[a-z0-9][a-z0-9_-]*"
              placeholder="myproject"
              // biome-ignore lint/a11y/noAutofocus: dialog convention
              autoFocus
              className="mt-1 block w-full rounded-md border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring/30"
            />
          </label>
          <label className="block text-sm">
            Name <span className="text-muted-foreground font-normal">(optional)</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full rounded-md border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring/30"
            />
          </label>
        </div>
        <label className="block text-sm mb-3">
          Link target{' '}
          <span className="text-muted-foreground font-normal">(optional, absolute path)</span>
          <input
            type="text"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="/home/you/projects/myrepo"
            className="mt-1 block w-full rounded-md border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring/30"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            Leave blank to create a fresh directory. Supply an absolute path to materialize the
            slot as a symlink to your existing project tree.
          </span>
        </label>
        {err && <p className="mt-2 text-sm text-rose-700">{err}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-3 py-2 text-sm text-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  )
}
