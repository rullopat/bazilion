// The list of keyboard shortcuts, opened with ? or from the palette.

import { SHORTCUTS } from '../lib/shortcuts'
import { Dialog } from './Dialog'

export function ShortcutsDialog({ mac, onClose }: { mac: boolean; onClose: () => void }) {
  return (
    <Dialog
      title="Keyboard shortcuts"
      description="The ones without ⌘ or Ctrl wait while you are typing in a field."
      onClose={onClose}
      className="max-w-lg"
    >
      <dl className="m-0 divide-y divide-border rounded-xl border border-border text-sm">
        {SHORTCUTS.map((shortcut) => (
          <div key={shortcut.does} className="flex items-center gap-4 px-3.5 py-2.5">
            <dt className="flex shrink-0 gap-1">
              {shortcut.keys(mac).map((key) => (
                <kbd
                  key={key}
                  className="min-w-7 rounded-md border border-border bg-muted px-1.5 py-0.5 text-center font-mono text-xs text-foreground"
                >
                  {key}
                </kbd>
              ))}
            </dt>
            <dd className="m-0 min-w-0 flex-1 text-foreground">
              {shortcut.does}
              {shortcut.where === 'workspace' && (
                <span className="text-muted-foreground"> (in the workspace)</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  )
}
