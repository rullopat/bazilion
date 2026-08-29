import { cn } from '../lib/utils'

export const SECTION_TABS_CLASS =
  'mb-6 flex max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-muted/50 p-1'

export function sectionTabClass(active: boolean): string {
  return cn(
    'inline-flex items-center whitespace-nowrap rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors sm:px-3 sm:text-sm',
    active
      ? 'border-border bg-card text-foreground shadow-baziu-sm'
      : 'border-transparent text-muted-foreground hover:bg-card/70 hover:text-foreground',
  )
}
