import type { ProviderConfigEntry } from '@bazilion/api-types'
import { describe, expect, test } from 'vitest'
import {
  groupProviders,
  providerHasConfiguration,
  providerMatches,
  providerReadiness,
} from '../src/lib/provider-presentation.ts'

describe('provider presentation', () => {
  test('puts configured providers first without duplicating featured or local entries', () => {
    const providers = [
      provider('ollama', { enabled: true, curated: ['llama3.3'] }),
      provider('openai'),
      provider('anthropic', { fieldSet: true }),
      provider('lmstudio'),
      provider('specialist'),
    ]

    const groups = groupProviders(providers)
    expect(groups.map((group) => group.key)).toEqual([
      'configured',
      'recommended',
      'local',
      'more',
    ])
    expect(groups[0]?.providers.map((item) => item.id)).toEqual(['ollama', 'anthropic'])
    expect(groups.flatMap((group) => group.providers.map((item) => item.id)).sort()).toEqual(
      providers.map((item) => item.id).sort(),
    )
  })

  test('searches human names, technical ids, fields, and models case-insensitively', () => {
    const item = provider('openai-codex', {
      displayName: 'OpenAI ChatGPT OAuth',
      curated: ['gpt-5.6-sol'],
      envVar: 'OPENAI_CODEX_OAUTH',
    })
    expect(providerMatches(item, 'chatgpt')).toBe(true)
    expect(providerMatches(item, 'CODEX_OAUTH')).toBe(true)
    expect(providerMatches(item, 'GPT-5.6')).toBe(true)
    expect(providerMatches(item, 'anthropic')).toBe(false)
  })

  test('distinguishes saved, model-incomplete, and test-ready states', () => {
    const saved = provider('anthropic', { fieldSet: true })
    const incomplete = provider('openai', { enabled: true })
    const ready = provider('ollama', { enabled: true, curated: ['llama3.3'] })

    expect(providerHasConfiguration(saved)).toBe(true)
    expect(providerReadiness(saved)).toEqual({ label: 'Saved, disabled', tone: 'neutral' })
    expect(providerReadiness(incomplete)).toEqual({ label: 'Needs a model', tone: 'warning' })
    expect(providerReadiness(ready)).toEqual({
      label: 'Configured, unverified',
      tone: 'warning',
    })
  })
})

function provider(
  id: string,
  options: {
    enabled?: boolean
    curated?: string[]
    displayName?: string
    fieldSet?: boolean
    envVar?: string
  } = {},
): ProviderConfigEntry {
  return {
    id,
    displayName: options.displayName ?? id,
    enabled: options.enabled ?? false,
    envHint: options.envVar ?? '',
    fields: options.envVar
      ? [
          {
            envVar: options.envVar,
            kind: 'secret',
            label: 'Credential',
            set: options.fieldSet ?? false,
          },
        ]
      : options.fieldSet
        ? [{ envVar: `${id.toUpperCase()}_KEY`, kind: 'secret', label: 'API key', set: true }]
        : [],
    catalog: [],
    curated: options.curated ?? [],
  }
}
