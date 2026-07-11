import { Link, useRouterState } from '@tanstack/react-router'

const TABS = [
  { suffix: '', label: 'overview', exact: true },
  { suffix: '/members', label: 'members' },
  { suffix: '/policy', label: 'policy' },
  { suffix: '/memory', label: 'memory' },
  { suffix: '/context', label: 'context' },
  { suffix: '/activity', label: 'activity' },
] as const

export function GroupTabs({ groupId }: { groupId: string }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const base = `/groups/${encodeURIComponent(groupId)}`
  return (
    <nav aria-label="Group sections" className="-mb-px mb-5 flex flex-wrap gap-1 border-b border-frost">
      {TABS.map((tab) => {
        const href = `${base}${tab.suffix}`
        const active =
          'exact' in tab && tab.exact
            ? pathname === base || pathname === `${base}/`
            : pathname.startsWith(href)
        return (
          <Link
            key={tab.label}
            to={href}
            aria-current={active ? 'page' : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${active ? 'border-sapphire text-sapphire' : 'border-transparent text-mocha hover:text-sapphire'}`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
