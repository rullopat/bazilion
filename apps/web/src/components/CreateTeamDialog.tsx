// Quick-create a team from the sidebar's spawn dropdown. POSTs to
// /api/teams with the current shape: { id, name?, link? }. The daemon
// puts the slot under ~/.bazilion/teams/<slug>/ — a fresh directory by
// default, or a symlink to `link` if provided.

import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from './Button'

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
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/45 p-4 backdrop-blur-sm"
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-team-title"
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-3xl border border-frost bg-card p-6 shadow-baziu-lg sm:p-7"
      >
        <h2 id="create-team-title" className="font-serif text-2xl text-foreground">Create a team</h2>
        <p className="text-sm text-muted-foreground mb-4">
          A team is a collaboration context — one filesystem root, one USER.md, one roster. The
          slot lives at <code className="font-mono">~/.bazilion/teams/&lt;slug&gt;/</code>.
        </p>
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
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
        {err && <p className="err mt-2">{err}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </form>
    </div>
  )
}
