// Sub-nav for the /config pages tree.

import { cn } from '../lib/utils'
import { SECTION_TABS_CLASS, sectionTabClass } from './SectionTabs'

type Tab = 'providers' | 'services' | 'mcp' | 'integrations' | 'tokens'

const TABS: { key: Tab; href: string; label: string }[] = [
  { key: 'providers', href: '/config', label: 'Providers' },
  { key: 'services', href: '/config/services', label: 'Services' },
  { key: 'mcp', href: '/config/mcp', label: 'MCP' },
  { key: 'integrations', href: '/config/integrations/telegram', label: 'Integrations' },
  { key: 'tokens', href: '/config/tokens', label: 'Tokens' },
]

export function ConfigTabs({ active, className }: { active: Tab; className?: string }) {
  return (
    <nav aria-label="Configuration sections" className={cn(SECTION_TABS_CLASS, className)}>
      {TABS.map((t) => (
        <a
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? 'page' : undefined}
          className={sectionTabClass(t.key === active)}
        >
          {t.label}
        </a>
      ))}
    </nav>
  )
}
