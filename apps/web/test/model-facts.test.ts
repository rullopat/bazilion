import type { CatalogModel, ChatModelEntry, ProviderConfigEntry } from '@bazilion/api-types'
import { expect, test } from 'vitest'
import { hostOf, localLine } from '../src/components/setup/AddProviderDialog.tsx'
import {
  ago,
  cheapest,
  credentialLine,
  factsLine,
  formatContext,
  formatUsd,
  initialPicks,
  matchesModel,
  menuFacts,
  menuGroups,
  priceLine,
  providerStatus,
  usedByLine,
} from '../src/lib/model-facts.ts'

const model = (id: string, more: Partial<CatalogModel> = {}): CatalogModel => ({
  id,
  selected: false,
  suggested: false,
  ...more,
})
const fable = model('claude-fable-5-2', {
  name: 'Claude Fable 5.2',
  contextWindow: 1_000_000,
  images: true,
  reasoning: true,
  price: { input: 8, output: 40 },
  suggested: true,
})
const haiku = model('claude-haiku-5-5', {
  name: 'Claude Haiku 5.5',
  contextWindow: 1_000_000,
  images: true,
  reasoning: true,
  price: { input: 0.1, output: 0.5 },
  suggested: true,
})

function provider(more: Partial<ProviderConfigEntry> = {}): ProviderConfigEntry {
  return {
    id: 'anthropic',
    displayName: 'Anthropic',
    connect: 'fields',
    group: 'popular',
    fields: [
      {
        envVar: 'ANTHROPIC_API_KEY',
        kind: 'secret',
        label: 'API key',
        input: { type: 'text' },
        set: true,
        preview: 'sk-ant…',
      },
    ],
    configured: true,
    enabled: true,
    listed: true,
    state: 'untested',
    models: [],
    suggested: [],
    catalogSize: 18,
    listsModels: false,
    ...more,
  }
}

test('sizes and prices are written the way people say them', () => {
  expect(formatContext(1_000_000)).toBe('1M')
  expect(formatContext(1_048_576)).toBe('1M')
  expect(formatContext(1_500_000)).toBe('1.5M')
  expect(formatContext(272_000)).toBe('272K')
  expect(formatContext(8_192)).toBe('8K')
  expect(formatContext(0)).toBeNull()
  expect(formatContext(undefined)).toBeNull()

  expect(formatUsd(8)).toBe('$8')
  expect(formatUsd(0.1)).toBe('$0.10')
  expect(formatUsd(1.25)).toBe('$1.25')
  expect(formatUsd(0.075)).toBe('$0.075')
  expect(formatUsd(3.96)).toBe('$3.96')
})

test('a model says what it can do and what it costs; one the catalog does not know says so', () => {
  expect(factsLine(fable, 'fields')).toBe('1M context · sees images · reasoning')
  expect(
    factsLine(model('codestral', { name: 'Codestral', contextWindow: 256_000 }), 'fields'),
  ).toBe('256K context · text only')
  expect(factsLine(model('qwen3:30b'), 'local')).toBe('Loaded on the server')
  expect(factsLine(model('brand-new'), 'fields')).toBe('Not in the bundled catalog')

  expect(priceLine(fable, 'fields')).toBe('$8 in · $40 out')
  expect(priceLine(haiku, 'fields')).toBe('$0.10 in · $0.50 out')
  // A plan and a local server are not priced per token, whatever the catalog says.
  expect(priceLine(fable, 'signin')).toBe('Included in your plan')
  expect(priceLine(model('qwen3:30b'), 'local')).toBe('Runs on your hardware')
  expect(priceLine(model('brand-new'), 'fields')).toBe('No list price')
})

test('who uses a model, and finding one by what is typed', () => {
  expect(usedByLine({ agents: 0, templates: [] })).toBe('Not used yet')
  expect(usedByLine({ agents: 1, templates: [] })).toBe('1 Agent')
  expect(usedByLine({ agents: 3, templates: ['Default'] })).toBe('Default template, 3 Agents')
  expect(usedByLine({ agents: 0, templates: ['Default', 'Writer'] })).toBe(
    'Default template, Writer template',
  )

  expect(matchesModel(haiku, 'haiku')).toBe(true)
  expect(matchesModel(haiku, 'claude 5.5')).toBe(true)
  expect(matchesModel(haiku, 'HAIKU-5')).toBe(true)
  expect(matchesModel(haiku, 'sonnet')).toBe(false)
  expect(matchesModel(haiku, '  ')).toBe(true)
})

test('the suggested models are ticked to begin with, unless some are already in use', () => {
  const opus = model('claude-opus-5-5', { price: { input: 4, output: 20 } })
  expect(initialPicks([fable, opus, haiku])).toEqual(['claude-fable-5-2', 'claude-haiku-5-5'])
  expect(initialPicks([fable, { ...opus, selected: true }, haiku])).toEqual(['claude-opus-5-5'])
  expect(initialPicks([opus])).toEqual([])

  // The test goes to the cheapest; without prices, to the first.
  expect(cheapest([fable, opus, haiku])?.id).toBe('claude-haiku-5-5')
  expect(cheapest([model('b'), model('a')])?.id).toBe('b')
  expect(cheapest([model('local'), haiku])?.id).toBe('claude-haiku-5-5')
  expect(cheapest([])).toBeUndefined()
})

test('time since a test reads as people say it', () => {
  const now = Date.UTC(2026, 10, 21, 12, 0, 0)
  const minute = 60_000
  expect(ago(now - 10_000, now)).toBe('just now')
  expect(ago(now - minute, now)).toBe('1 minute ago')
  expect(ago(now - 12 * minute, now)).toBe('12 minutes ago')
  expect(ago(now - 60 * minute, now)).toBe('1 hour ago')
  expect(ago(now - 5 * 60 * minute, now)).toBe('5 hours ago')
  expect(ago(now - 26 * 60 * minute, now)).toBe('yesterday')
  expect(ago(now - 4 * 24 * 60 * minute, now)).toBe('4 days ago')
  expect(ago(now - 60 * 24 * 60 * minute, now)).toBe('on 2026-09-22')
  // A clock that is a little behind never reads as the future.
  expect(ago(now + 5_000, now)).toBe('just now')
})

test('a provider chip says what the last test found, never just "enabled"', () => {
  const now = 1_000_000_000
  const at = now - 120_000
  expect(providerStatus(provider(), now)).toEqual({ label: 'Not tested yet', tone: 'neutral' })
  expect(
    providerStatus(
      provider({ state: 'working', check: { ok: true, at, model: 'm', ms: 900 } }),
      now,
    ),
  ).toEqual({ label: 'Working · tested 2 minutes ago', tone: 'success' })
  const failing = (kind: 'credentials' | 'unreachable' | 'model' | 'limit' | 'other') =>
    providerStatus(
      provider({
        state: 'failing',
        check: { ok: false, at, model: 'm', failure: { kind, title: '', hint: '', detail: '' } },
      }),
      now,
    )
  expect(failing('credentials')).toEqual({
    label: 'Key rejected · tried 2 minutes ago',
    tone: 'warning',
  })
  expect(failing('unreachable').label).toBe('Not answering · tried 2 minutes ago')
  expect(failing('model').label).toBe('Model unavailable · tried 2 minutes ago')
  expect(failing('limit').label).toBe('Limit reached · tried 2 minutes ago')
  expect(providerStatus(provider({ state: 'incomplete' }), now)).toEqual({
    label: 'Needs a key',
    tone: 'warning',
  })
  expect(
    providerStatus(provider({ state: 'incomplete', connect: 'signin', fields: [] }), now).label,
  ).toBe('Not signed in')
  expect(providerStatus(provider({ state: 'off', models: ['claude-haiku-5-5'] }), now)).toEqual({
    label: 'Turned off',
    tone: 'neutral',
  })
  // A key saved the old way, with no model chosen, was never on.
  expect(providerStatus(provider({ state: 'off' }), now).label).toBe('Saved, not in use')
})

test('a provider row says how it is connected without showing a secret', () => {
  expect(credentialLine(provider())).toBe('API key sk-ant…')
  expect(credentialLine(provider({ fields: [], configured: true }))).toBe(
    'Credentials from the daemon’s environment',
  )
  expect(credentialLine(provider({ fields: [], configured: false }))).toBe('No credentials saved')
  expect(credentialLine(provider({ connect: 'signin', fields: [] }))).toBe(
    'Signed in with your ChatGPT account',
  )
  expect(
    credentialLine(provider({ connect: 'local', fields: [], address: 'http://127.0.0.1:1234/v1' })),
  ).toBe('http://127.0.0.1:1234/v1')
})

test('a local server is described by where it was looked for', () => {
  expect(hostOf('http://127.0.0.1:11434/v1')).toBe('127.0.0.1:11434')
  expect(hostOf('not a url')).toBe('not a url')
  const server = { id: 'ollama', displayName: 'Ollama', address: 'http://127.0.0.1:11434/v1' }
  expect(localLine(undefined, true)).toBe('Looking…')
  expect(localLine({ ...server, found: false, models: [] }, false)).toBe(
    'Nothing at 127.0.0.1:11434',
  )
  expect(localLine({ ...server, found: true, models: ['a'] }, false)).toBe(
    'Running at 127.0.0.1:11434, 1 model',
  )
  expect(localLine({ ...server, found: true, models: ['a', 'b', 'c'] }, false)).toBe(
    'Running at 127.0.0.1:11434, 3 models',
  )
})

test('a model menu names models by provider, with the two facts that matter when choosing', () => {
  const entry = (
    value: string,
    providerName: string,
    more: Partial<ChatModelEntry> = {},
  ): ChatModelEntry => ({
    id: value.slice(value.indexOf(':') + 1),
    value,
    provider: value.slice(0, value.indexOf(':')),
    providerName,
    providerConnect: 'fields',
    providerState: 'working',
    selected: true,
    suggested: false,
    usedBy: { agents: 0, templates: [] },
    ...more,
  })
  const claude = entry('anthropic:claude-fable-5-2', 'Anthropic', {
    name: 'Claude Fable 5.2',
    contextWindow: 1_000_000,
    images: true,
  })
  const textOnly = entry('anthropic:claude-text', 'Anthropic', { contextWindow: 272_000 })
  const local = entry('ollama:llama3.3', 'Ollama', {
    providerConnect: 'local',
    providerState: 'failing',
  })
  const unknown = entry('mistral:new-model', 'Mistral', { providerState: 'incomplete' })
  expect(menuFacts(claude)).toBe('1M · sees images')
  expect(menuFacts(textOnly)).toBe('272K · text only')
  expect(menuFacts(local)).toBe('on this computer')
  // Nothing is known about it: better no facts than made-up ones.
  expect(menuFacts(unknown)).toBe('')

  expect(
    menuGroups([claude, local, textOnly, unknown]).map((group) => [
      group.name,
      group.trouble,
      group.models.map((model) => model.id),
    ]),
  ).toEqual([
    ['Anthropic', null, ['claude-fable-5-2', 'claude-text']],
    ['Ollama', 'not working', ['llama3.3']],
    ['Mistral', 'not working', ['new-model']],
  ])
  expect(menuGroups([])).toEqual([])
})
