#!/usr/bin/env node

import { readFileSync } from 'node:fs'

const piDist = new URL(
  '../../../../apps/daemon/node_modules/@earendil-works/pi-ai/dist/',
  import.meta.url,
)
const pi = await import(new URL('providers/all.js', piDist).href)
const { getBuiltinModels, getBuiltinProviders } = pi

const source = readFileSync('apps/web/src/routes/config/index.tsx', 'utf8')
const servicesSource = readFileSync('apps/daemon/src/core/services.ts', 'utf8')
const examples = new Map()
for (const match of source.matchAll(/case '([^']+)':\s+return '([^']+)'/g)) {
  examples.set(match[1], match[2])
}

const aliases = new Map([
  ['bedrock', 'amazon-bedrock'],
  ['azure-openai', 'azure-openai-responses'],
])
const providers = getBuiltinProviders()
const report = []
const full = process.argv.includes('--full')

for (const provider of providers) {
  const models = getBuiltinModels(provider).map((model) => model.id)
  report.push({ provider, count: models.length, models })
}

const failures = []
const bazilionProviders = [
  ...servicesSource.matchAll(/id: '([^']+)'[\s\S]{0,160}?category: 'provider'/g),
].map((match) => match[1])
const piToBazilion = new Map([
  ['amazon-bedrock', 'bedrock'],
  ['azure-openai-responses', 'azure-openai'],
])
for (const provider of providers) {
  const bazilionProvider = piToBazilion.get(provider) ?? provider
  if (!bazilionProviders.includes(bazilionProvider)) {
    failures.push(`Pi provider '${provider}' has no Bazilion provider surface`)
  }
}
for (const [provider, example] of examples) {
  const piProvider = aliases.get(provider) ?? provider
  if (!providers.includes(piProvider)) continue // dynamic/local Bazilion provider
  const models = getBuiltinModels(piProvider).map((model) => model.id)
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
  console.error('\nProvider/catalog reconciliation failures:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log('\nAll catalog-backed web examples resolve in the installed Pi catalog.')
}
