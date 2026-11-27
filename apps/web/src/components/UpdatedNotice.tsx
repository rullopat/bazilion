// "Bazilion was updated": shown when the server answers from a newer build than this tab's, after
// an upgrade the tab stayed open through. Reloading gets the new version; what was typed and not
// sent is kept for the tab (components/chat/ChatPane.tsx).

import { RefreshCw } from 'lucide-react'
import { useServerUpdated } from '../lib/build'
import { Button } from './Button'

export function UpdatedNotice() {
  const updated = useServerUpdated()
  if (!updated) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-3">
      <div
        role="status"
        className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-2xl border border-sapphire-light bg-snow px-4 py-2.5 text-sm text-chocolate shadow-baziu-lg"
      >
        <RefreshCw className="size-4 shrink-0 text-sapphire" aria-hidden="true" />
        <span>Bazilion was updated. Reload to use the new version.</span>
        <Button variant="primary" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    </div>
  )
}
