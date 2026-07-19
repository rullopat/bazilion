import { Link, useRouterState } from '@tanstack/react-router'
import { SECTION_TABS_CLASS, sectionTabClass } from './SectionTabs'

const TABS = [
  { suffix: '', label: 'Overview', exact: true },
  { suffix: '/members', label: 'Members' },
  { suffix: '/policy', label: 'Policy' },
  { suffix: '/memory', label: 'Memory' },
  { suffix: '/context', label: 'Context' },
  { suffix: '/activity', label: 'Activity' },
] as const

export function TeamTabs({ teamId }: { teamId: string }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const base = `/teams/${encodeURIComponent(teamId)}`
  return (
    <nav aria-label="Team sections" className={SECTION_TABS_CLASS}>
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
            className={sectionTabClass(active)}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
