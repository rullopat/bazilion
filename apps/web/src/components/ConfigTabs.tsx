// Sub-nav for the /config pages tree.

type Tab = 'providers' | 'services' | 'integrations' | 'tokens'

const TABS: { key: Tab; href: string; label: string }[] = [
  { key: 'providers', href: '/config', label: 'providers' },
  { key: 'services', href: '/config/services', label: 'services' },
  { key: 'integrations', href: '/config/integrations/telegram', label: 'integrations' },
  { key: 'tokens', href: '/config/tokens', label: 'tokens' },
]

export function ConfigTabs({ active }: { active: Tab }) {
  return (
    <nav className="flex gap-1 border-b mb-6">
      {TABS.map((t) => (
        <a
          key={t.key}
          href={t.href}
          className={`px-3 py-2 text-sm border-b-2 -mb-px ${
            t.key === active
              ? 'border-primary text-primary font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          {t.label}
        </a>
      ))}
    </nav>
  )
}
