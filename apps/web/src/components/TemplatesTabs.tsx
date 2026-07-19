import { Link, useRouterState } from '@tanstack/react-router'
import { SECTION_TABS_CLASS, sectionTabClass } from './SectionTabs'

// Sub-tabs for the unified "templates" nav section. Both profiles and
// profile teams are spawn-time templates; they share a parent in the
// TopNav and disambiguate here. Active state is derived from the current
// pathname so it survives client-side navigation without prop drilling.
export function TemplatesTabs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const tabs = [
    {
      to: '/templates/agents',
      label: 'Agent templates',
      match: (p: string) => p.startsWith('/templates/agents'),
    },
    {
      to: '/templates/teams',
      label: 'Team templates',
      match: (p: string) => p.startsWith('/templates/teams'),
    },
  ] as const
  return (
    <nav role="tablist" className={SECTION_TABS_CLASS}>
      {tabs.map((t) => {
        const active = t.match(pathname)
        return (
          <Link
            key={t.to}
            to={t.to}
            role="tab"
            aria-selected={active}
            className={sectionTabClass(active)}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
