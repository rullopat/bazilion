// How Setup words a model and a provider: sizes, prices, who uses what, and what a state means.

import type {
  CatalogModel,
  ChatModelEntry,
  ProviderConfigEntry,
  ProviderFailureKind,
} from '@bazilion/api-types'

type Connect = ProviderConfigEntry['connect']

export function modelName(model: Pick<CatalogModel, 'id' | 'name'>): string {
  return model.name ?? model.id
}

/** A context window in the units people say: `1M`, `272K`. */
export function formatContext(tokens: number | undefined): string | null {
  if (!tokens || tokens <= 0) return null
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  return `${Math.round(tokens / 1_000)}K`
}

/** A dollar amount with cents, and the third decimal only when it carries something. */
export function formatUsd(value: number): string {
  if (Number.isInteger(value)) return `$${value}`
  const fixed = value.toFixed(3)
  return `$${fixed.endsWith('0') ? fixed.slice(0, -1) : fixed}`
}

/** What a model can do, in one line. A model the catalog does not know has nothing to say. */
export function factsLine(model: CatalogModel, connect: Connect): string {
  const context = formatContext(model.contextWindow)
  if (!model.name && !context) {
    return connect === 'local' ? 'Loaded on the server' : 'Not in the bundled catalog'
  }
  return [
    context ? `${context} context` : null,
    model.images ? 'sees images' : 'text only',
    model.reasoning ? 'reasoning' : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** What a model costs: the list price per million tokens, or who pays instead. */
export function priceLine(model: CatalogModel, connect: Connect): string {
  if (connect === 'signin') return 'Included in your plan'
  if (connect === 'local') return 'Runs on your hardware'
  if (!model.price) return 'No list price'
  return `${formatUsd(model.price.input)} in · ${formatUsd(model.price.output)} out`
}

export function usedByLine(usedBy: ChatModelEntry['usedBy']): string {
  const parts = [
    ...usedBy.templates.map((name) => `${name} template`),
    usedBy.agents === 1 ? '1 Agent' : usedBy.agents > 1 ? `${usedBy.agents} Agents` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : 'Not used yet'
}

/** Whether a model matches what was typed: every word, in its name or id. */
export function matchesModel(model: Pick<CatalogModel, 'id' | 'name'>, query: string): boolean {
  const haystack = `${model.name ?? ''} ${model.id}`.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
}

/** "2 minutes ago", for something that happened at `at`. */
export function ago(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  const days = Math.round(hours / 24)
  if (days < 30) return days === 1 ? 'yesterday' : `${days} days ago`
  return `on ${new Date(at).toISOString().slice(0, 10)}`
}

export type Tone = 'success' | 'warning' | 'neutral'

const FAILURE_LABEL: Record<ProviderFailureKind, string> = {
  credentials: 'Key rejected',
  unreachable: 'Not answering',
  model: 'Model unavailable',
  limit: 'Limit reached',
  other: 'Failing',
}

/** A provider's state as a chip: a few words and how loud they are. */
export function providerStatus(
  provider: Pick<ProviderConfigEntry, 'state' | 'check' | 'connect' | 'fields' | 'models'>,
  now: number,
): { label: string; tone: Tone } {
  switch (provider.state) {
    case 'working':
      return {
        label: provider.check ? `Working · tested ${ago(provider.check.at, now)}` : 'Working',
        tone: 'success',
      }
    case 'failing': {
      const kind = provider.check?.failure?.kind ?? 'other'
      const label =
        kind === 'credentials' && provider.connect === 'signin'
          ? 'Sign-in rejected'
          : FAILURE_LABEL[kind]
      return {
        label: provider.check ? `${label} · tried ${ago(provider.check.at, now)}` : label,
        tone: 'warning',
      }
    }
    case 'incomplete':
      return {
        label:
          provider.connect === 'signin'
            ? 'Not signed in'
            : provider.fields.some((field) => field.kind === 'secret')
              ? 'Needs a key'
              : 'Needs credentials',
        tone: 'warning',
      }
    case 'off':
      // A key that was saved and never put to use is not something that was turned off.
      return {
        label: provider.models.length === 0 ? 'Saved, not in use' : 'Turned off',
        tone: 'neutral',
      }
    default:
      return { label: 'Not tested yet', tone: 'neutral' }
  }
}

/** How a provider is connected, in a few words, for its row. */
export function credentialLine(provider: ProviderConfigEntry): string {
  if (provider.connect === 'signin') {
    return provider.configured ? 'Signed in with your ChatGPT account' : 'Not signed in'
  }
  if (provider.connect === 'local') return provider.address ?? 'A model server on this network'
  const key = provider.fields.find((field) => field.kind === 'secret' && field.set)
  if (key) return `${key.label} ${key.preview ?? 'saved'}`
  if (provider.configured) return 'Credentials from the daemon’s environment'
  return 'No credentials saved'
}

/** The models to ask first: suggested ones, then the ones already in use. */
export function initialPicks(models: readonly CatalogModel[]): string[] {
  const selected = models.filter((model) => model.selected).map((model) => model.id)
  if (selected.length > 0) return selected
  return models.filter((model) => model.suggested).map((model) => model.id)
}

/** The cheapest of the given models by list price; unpriced ones come last, in order. */
export function cheapest(models: readonly CatalogModel[]): CatalogModel | undefined {
  const cost = (model: CatalogModel) =>
    model.price ? model.price.input + model.price.output : Number.POSITIVE_INFINITY
  return models
    .map((model, index) => ({ model, index }))
    .sort((a, b) => cost(a.model) - cost(b.model) || a.index - b.index)[0]?.model
}
