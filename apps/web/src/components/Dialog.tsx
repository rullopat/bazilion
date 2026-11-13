import { X } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react'
import { cn } from '../lib/utils'

type FocusTarget = Element & { focus: (options?: FocusOptions) => void }

const useBrowserLayoutEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect

/** The element to refocus when a dialog closes: whatever had focus when it opened. */
export function getDialogFocusRestoreTarget(doc: Document): FocusTarget | null {
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
  return target as FocusTarget
}

export function restoreDialogFocus(target: FocusTarget | null, doc: Document): void {
  if (!target?.isConnected || target.ownerDocument !== doc) return
  target.focus({ preventScroll: true })
}

/**
 * The app's one modal. While `busy`, it cannot be dismissed. Radix refocuses a DialogTrigger on
 * close; these dialogs open from state, so the element focused at opening is restored instead.
 */
export function Dialog({
  open = true,
  onClose,
  busy = false,
  title,
  description,
  className,
  children,
}: {
  open?: boolean
  onClose: () => void
  busy?: boolean
  title: ReactNode
  description?: ReactNode
  className?: string
  children: ReactNode
}) {
  const opener = useRef<FocusTarget | null>(null)
  const wasOpen = useRef(false)
  useBrowserLayoutEffect(() => {
    if (open && !wasOpen.current) opener.current = getDialogFocusRestoreTarget(document)
    wasOpen.current = open
  }, [open])

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-chocolate/35 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-[16px] border border-frost bg-snow p-5 text-chocolate shadow-baziu-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:p-6',
            className,
          )}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            restoreDialogFocus(opener.current, document)
            opener.current = null
          }}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault()
          }}
          onPointerDownOutside={(event) => {
            if (busy) event.preventDefault()
          }}
        >
          <div className="flex flex-col gap-2 pr-6">
            <DialogPrimitive.Title className="font-serif text-xl text-chocolate">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description asChild>
                <div className="text-sm leading-6 text-mocha">{description}</div>
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          {children}
          {!busy && (
            <DialogPrimitive.Close
              aria-label="Close"
              className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-lg text-mocha hover:bg-ivory hover:text-sapphire"
            >
              <X className="size-4" aria-hidden="true" />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/** The button row at the bottom of a dialog. */
export function DialogActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-2 border-t border-frost pt-4 sm:flex-row sm:justify-end">
      {children}
    </div>
  )
}
