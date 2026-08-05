import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const COMPATIBLE_PI_VERSION = '0.80.6'
const PI_PACKAGES = [
  '@earendil-works/pi-agent-core',
  '@earendil-works/pi-ai',
  '@earendil-works/pi-coding-agent',
] as const

test('published CLI pins the Pi package family to its tested compatible version', () => {
  const manifest = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
  ) as { dependencies: Record<string, string> }

  for (const name of PI_PACKAGES) {
    expect(manifest.dependencies[name]).toBe(COMPATIBLE_PI_VERSION)
  }
})
