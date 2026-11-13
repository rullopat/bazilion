import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

/**
 * Sub-navigation of a page family: links under `base`, each `[suffix, label]`. A tab is current
 * on its own path and below it; the empty suffix is current on `base` only. The router marks the
 * current tab (`aria-current="page"`, active props), whatever the search string.
 */
export function SectionTabs({
  label,
  base,
  tabs,
  children,
}: {
  label: string
  base: string
  tabs: readonly (readonly [suffix: string, label: string])[]
  children?: ReactNode
}) {
  return (
    <nav
      aria-label={label}
      className="mb-6 flex max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-muted/50 p-1"
    >
      {tabs.map(([suffix, text]) => {
        const href = `${base}${suffix}`
        return (
          <Link
            key={href}
            to={href}
            activeOptions={{ exact: !suffix, includeSearch: false }}
            className="inline-flex items-center whitespace-nowrap rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors sm:px-3 sm:text-sm"
            activeProps={{ className: 'border-border bg-card text-foreground shadow-baziu-sm' }}
            inactiveProps={{
              className:
                'border-transparent text-muted-foreground hover:bg-card/70 hover:text-foreground',
            }}
          >
            {text}
          </Link>
        )
      })}
      {children}
    </nav>
  )
}

export const AGENT_TABS = [
  ['', 'Chat'],
  ['/inbox', 'Inbox'],
  ['/triggers', 'Triggers'],
  ['/learning', 'Learning'],
  ['/settings', 'Settings'],
] as const

export const TEAM_TABS = [
  ['', 'Context'],
  ['/members', 'Members'],
  ['/policy', 'Policy'],
  ['/memory', 'Memory'],
  ['/review', 'Review'],
  ['/results', 'Results'],
] as const

export const TEMPLATE_TABS = [
  ['/agents', 'Agent templates'],
  ['/teams', 'Team templates'],
] as const

export const CONFIG_TABS = [
  ['', 'Providers'],
  ['/services', 'Services'],
  ['/mcp', 'MCP'],
  ['/integrations/telegram', 'Integrations'],
  ['/tokens', 'Tokens'],
] as const
