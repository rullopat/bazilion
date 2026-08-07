import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const PI_PACKAGES = [
  '@earendil-works/pi-agent-core',
  '@earendil-works/pi-ai',
  '@earendil-works/pi-coding-agent',
] as const

test('published CLI pins the Pi package family to its tested compatible version', () => {
  const manifest = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
  ) as { dependencies: Record<string, string> }

  const compatibleVersion = manifest.dependencies['@earendil-works/pi-ai']
  expect(compatibleVersion).toMatch(/^\d+\.\d+\.\d+$/)
  for (const name of PI_PACKAGES) {
    expect(manifest.dependencies[name]).toBe(compatibleVersion)
  }
})
