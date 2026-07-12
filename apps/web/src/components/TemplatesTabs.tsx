import { Link, useRouterState } from '@tanstack/react-router'

// Sub-tabs for the unified "templates" nav section. Both profiles and
// profile teams are spawn-time templates; they share a parent in the
// TopNav and disambiguate here. Active state is derived from the current
// pathname so it survives client-side navigation without prop drilling.
export function TemplatesTabs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const tabs = [
    {
      to: '/templates/agents',
      label: 'agent templates',
      match: (p: string) => p.startsWith('/templates/agents'),
    },
    {
      to: '/templates/teams',
      label: 'team templates',
      match: (p: string) => p.startsWith('/templates/teams'),
    },
  ] as const
  return (
    <nav role="tablist" className="-mb-px mb-5 flex gap-1 border-b border-frost">
      {tabs.map((t) => {
        const active = t.match(pathname)
        return (
          <Link
            key={t.to}
            to={t.to}
            role="tab"
            aria-selected={active}
            className={`unstyled cursor-pointer border-b-2 bg-transparent px-4 py-2 text-[0.9em] font-medium transition-colors ${
              active
                ? 'border-sapphire text-sapphire'
                : 'border-transparent text-mocha hover:text-sapphire'
            }`}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
