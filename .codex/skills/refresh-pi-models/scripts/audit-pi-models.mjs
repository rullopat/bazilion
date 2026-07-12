#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'

const piDist = new URL(
  '../../../../apps/daemon/node_modules/@earendil-works/pi-ai/dist/',
  import.meta.url,
)
const compat = new URL('compat.js', piDist)
const pi = await import(existsSync(compat) ? compat.href : new URL('index.js', piDist).href)
const { getModels, getProviders } = pi
if (typeof getModels !== 'function' || typeof getProviders !== 'function') {
  throw new Error('installed pi-ai exposes neither the compat nor legacy catalog helpers')
}

const source = readFileSync('apps/web/src/routes/config/index.tsx', 'utf8')
const examples = new Map()
for (const match of source.matchAll(/case '([^']+)':\s+return '([^']+)'/g)) {
  examples.set(match[1], match[2])
}

const aliases = new Map([
  ['bedrock', 'amazon-bedrock'],
  ['azure-openai', 'azure-openai-responses'],
])
const providers = getProviders()
const report = []
const full = process.argv.includes('--full')

for (const provider of providers) {
  const models = (getModels(provider) ?? []).map((model) => model.id)
  report.push({ provider, count: models.length, models })
}

const failures = []
for (const [provider, example] of examples) {
  const piProvider = aliases.get(provider) ?? provider
  if (!providers.includes(piProvider)) continue // dynamic/local Bazilion provider
  const models = (getModels(piProvider) ?? []).map((model) => model.id)
  if (models.length > 0 && !models.includes(example)) {
    failures.push(`${provider}: example '${example}' is absent from Pi provider '${piProvider}'`)
  }
}

for (const entry of report) {
  console.log(`${entry.provider}: ${entry.count}`)
  if (full) console.log(entry.models.map((model) => `  ${model}`).join('\n'))
}

const newOpenAI = report
  .find((entry) => entry.provider === 'openai')
  ?.models.filter((model) => /^gpt-5\.\d/.test(model))
console.log(`\nRecent OpenAI families: ${(newOpenAI ?? []).slice(-12).join(', ')}`)

if (failures.length > 0) {
  console.error('\nStale catalog-backed examples:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log('\nAll catalog-backed web examples resolve in the installed Pi catalog.')
}
