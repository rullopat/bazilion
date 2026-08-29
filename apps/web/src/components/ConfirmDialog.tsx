import { Dialog as DialogPrimitive } from 'radix-ui'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button } from './Button'

type DialogFocusRestoreTarget = Element & {
  focus: (options?: FocusOptions) => void
}

const useBrowserLayoutEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect

export function getDialogFocusRestoreTarget(doc: Document): DialogFocusRestoreTarget | null {
  const target = doc.activeElement
  if (
    !target ||
    target === doc.body ||
    target === doc.documentElement ||
    !('focus' in target) ||
    typeof target.focus !== 'function'
  ) {
    return null
  }
  return target as DialogFocusRestoreTarget
}

export function restoreDialogFocus(
  target: DialogFocusRestoreTarget | null,
  doc: Document,
): void {
  if (!target || !target.isConnected || target.ownerDocument !== doc) return
  target.focus({ preventScroll: true })
}

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
  const focusRestoreTargetRef = useRef<DialogFocusRestoreTarget | null>(null)
  const wasOpenRef = useRef(false)

  useBrowserLayoutEffect(() => {
    if (open && !wasOpenRef.current) {
      focusRestoreTargetRef.current = getDialogFocusRestoreTarget(document)
    }
    wasOpenRef.current = open
  }, [open])

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
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const target = focusRestoreTargetRef.current
            focusRestoreTargetRef.current = null
            restoreDialogFocus(target, document)
          }}
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
