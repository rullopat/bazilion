import type { ReactNode } from 'react'
import { Dialog } from '../Dialog'

/**
 * A deeper page of an Agent or a Team, opened over the workspace so the conversation stays where
 * it is. Its address carries `section`, so the browser's back button closes it.
 */
export function Sheet({
  title,
  description,
  onClose,
  busy = false,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  onClose: () => void
  busy?: boolean
  children: ReactNode
}) {
  return (
    <Dialog
      title={title}
      description={description}
      onClose={onClose}
      busy={busy}
      className="top-[4dvh] max-h-[92dvh] max-w-5xl translate-y-0 content-start"
    >
      <div className="min-w-0">{children}</div>
    </Dialog>
  )
}
