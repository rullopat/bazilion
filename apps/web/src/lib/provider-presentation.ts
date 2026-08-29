import type { ProviderConfigEntry } from '@bazilion/api-types'

export type ProviderSectionKey = 'configured' | 'recommended' | 'local' | 'more'

export interface ProviderSection {
  key: ProviderSectionKey
  title: string
  description: string
  providers: ProviderConfigEntry[]
}

const RECOMMENDED = new Set(['openai-codex', 'openai', 'anthropic', 'google'])
const LOCAL = new Set(['ollama', 'lmstudio', 'llamacpp'])

export function providerHasConfiguration(provider: ProviderConfigEntry): boolean {
  return (
    provider.enabled ||
    provider.curated.length > 0 ||
    provider.fields.some((field) => field.set)
  )
}

export function providerMatches(provider: ProviderConfigEntry, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return true
  return [
    provider.id,
    provider.displayName,
    provider.hint ?? '',
    provider.envHint,
    ...provider.fields.flatMap((field) => [field.label, field.envVar]),
    ...provider.curated,
    ...provider.catalog,
  ].some((value) => value.toLocaleLowerCase().includes(needle))
}

export function groupProviders(
  providers: ProviderConfigEntry[],
  query = '',
): ProviderSection[] {
  const visible = providers.filter((provider) => providerMatches(provider, query))
  const configured = visible.filter(providerHasConfiguration)
  const configuredIds = new Set(configured.map((provider) => provider.id))
  const remaining = visible.filter((provider) => !configuredIds.has(provider.id))

  const sections: ProviderSection[] = [
    {
      key: 'configured',
      title: 'Configured',
      description: 'Providers you enabled, added models to, or saved credentials for.',
      providers: configured,
    },
    {
      key: 'recommended',
      title: 'Recommended starting points',
      description: 'The simplest hosted options for a first Bazilion conversation.',
      providers: remaining.filter((provider) => RECOMMENDED.has(provider.id)),
    },
    {
      key: 'local',
      title: 'Local models',
      description: 'Use a model server on the same machine without exposing the daemon.',
      providers: remaining.filter((provider) => LOCAL.has(provider.id)),
    },
    {
      key: 'more',
      title: 'More providers',
      description: 'Specialist, regional, enterprise, and subscription endpoints.',
      providers: remaining.filter(
        (provider) => !RECOMMENDED.has(provider.id) && !LOCAL.has(provider.id),
      ),
    },
  ]

  return sections.filter((section) => section.providers.length > 0)
}

export function providerReadiness(provider: ProviderConfigEntry): {
  label: string
  tone: 'neutral' | 'warning' | 'success'
} {
  if (!provider.enabled) {
    return providerHasConfiguration(provider)
      ? { label: 'Saved, disabled', tone: 'neutral' }
      : { label: 'Not configured', tone: 'neutral' }
  }
  if (provider.curated.length === 0) return { label: 'Needs a model', tone: 'warning' }
  return { label: 'Configured, unverified', tone: 'warning' }
}
