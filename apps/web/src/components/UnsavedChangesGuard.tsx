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

  const destination = blocker.status === 'blocked' ? blocker.next.pathname : ''

  return (
    <ConfirmDialog
      open={blocker.status === 'blocked'}
      title={`Discard unsaved ${subject}?`}
      description={
        <p>
          Leaving this page for <code className="font-mono">{destination}</code> will permanently
          discard the unsaved {subject} on this page.
        </p>
      }
      confirmLabel="discard and leave"
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
