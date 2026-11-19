import { useBlocker } from '@tanstack/react-router'
import { useCallback, useRef } from 'react'
import { ConfirmDialog } from './ConfirmDialog'

export function UnsavedChangesGuard({
  when,
  subject = 'changes',
}: {
  when: boolean
  subject?: string
}) {
  const proceeding = useRef(false)
  const shouldBlock = useCallback(() => when, [when])
  const blocker = useBlocker({
    shouldBlockFn: shouldBlock,
    enableBeforeUnload: when,
    disabled: !when,
    withResolver: true,
  })

  // Closing a sheet or switching a tab stays on the page: there is no other page to name.
  const destination =
    blocker.status === 'blocked' && blocker.next.pathname !== blocker.current.pathname
      ? blocker.next.pathname
      : ''

  return (
    <ConfirmDialog
      open={blocker.status === 'blocked'}
      title={`Discard unsaved ${subject}?`}
      description={
        destination ? (
          <p>
            Leaving this page for <code className="font-mono">{destination}</code> will permanently
            discard the unsaved {subject} on this page.
          </p>
        ) : (
          <p>Going on will permanently discard the unsaved {subject}.</p>
        )
      }
      confirmLabel={destination ? 'Discard and leave' : 'Discard'}
      onConfirm={() => {
        proceeding.current = true
        blocker.proceed?.()
      }}
      onOpenChange={(open) => {
        if (!open && !proceeding.current) blocker.reset?.()
        if (!open) proceeding.current = false
      }}
    />
  )
}
