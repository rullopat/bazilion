import { Dialog as DialogPrimitive } from 'radix-ui'
import { useEffect, useState } from 'react'
import { Button } from './Button'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: React.ReactNode
  confirmLabel: string
  confirmVariant?: 'primary' | 'danger'
  onConfirm: () => void | Promise<void>
  onOpenChange: (open: boolean) => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmVariant = 'danger',
  onConfirm,
  onOpenChange,
}: ConfirmDialogProps) {
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
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onOpenChange(false)
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-chocolate/35 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-[16px] border border-frost bg-snow p-5 text-chocolate shadow-baziu-lg outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault()
          }}
          onPointerDownOutside={(event) => {
            if (busy) event.preventDefault()
          }}
        >
          <div className="flex flex-col gap-2">
            <DialogPrimitive.Title className="font-serif text-xl text-chocolate">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description asChild>
              <div className="text-sm leading-6 text-mocha">{description}</div>
            </DialogPrimitive.Description>
          </div>
          {error && (
            <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 border-t border-frost pt-4 sm:flex-row sm:justify-end">
            <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
              cancel
            </Button>
            <Button variant={confirmVariant} disabled={busy} onClick={() => void confirm()}>
              {busy ? 'working…' : confirmLabel}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
