import { type ReactNode, useEffect, useState } from 'react'
import { errorMessage } from '../lib/api'
import { Button } from './Button'
import { Dialog, DialogActions } from './Dialog'

/** Ask before a consequential action; `onConfirm` failures stay in the dialog. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmVariant = 'danger',
  onConfirm,
  onOpenChange,
}: {
  open: boolean
  title: string
  description: ReactNode
  confirmLabel: string
  confirmVariant?: 'primary' | 'danger'
  onConfirm: () => void | Promise<void>
  onOpenChange: (open: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setBusy(false)
      setError(null)
    }
  }, [open])

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      busy={busy}
      onClose={() => onOpenChange(false)}
      title={title}
      description={description}
      className="max-w-md"
    >
      {error && (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <DialogActions>
        <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button variant={confirmVariant} disabled={busy} onClick={() => void confirm()}>
          {busy ? 'Working…' : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
