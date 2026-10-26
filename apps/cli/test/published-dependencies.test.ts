import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

// Runtime imports left external by the production web SSR build. They must be
// direct dependencies of the package that ships dist/web, not checkout-only deps.
const WEB_SSR_PACKAGES = [
  '@tanstack/react-router',
  '@xyflow/react',
  'class-variance-authority',
  'clsx',
  'dompurify',
  'lucide-react',
  'marked',
  'radix-ui',
  'react',
  'react-dom',
  'tailwind-merge',
] as const

test('published CLI declares the tested web SSR runtime dependencies', () => {
  const cli = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'))
  const web = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', '..', 'web', 'package.json'), 'utf8'),
  )
  for (const name of WEB_SSR_PACKAGES) {
    expect(web.dependencies[name], name).toBeTypeOf('string')
    expect(cli.dependencies[name], name).toBe(web.dependencies[name])
  }
})

test('CLI and daemon require Node releases with the fixed cleanup-hook API', () => {
  for (const relative of [
    '../../../package.json',
    '../package.json',
    '../../daemon/package.json',
  ]) {
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, relative), 'utf8'))
    expect(manifest.engines.node, relative).toBe('^24.22.0 || ^26.12.1')
  }
})

const PI_PACKAGES = [
  '@earendil-works/pi-agent-core',
  '@earendil-works/pi-ai',
  '@earendil-works/pi-coding-agent',
  '@earendil-works/pi-mcp',
] as const

test('published CLI pins the Pi package family to its tested compatible version', () => {
  for (const relative of ['../package.json', '../../daemon/package.json']) {
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, relative), 'utf8')) as {
      dependencies: Record<string, string>
    }
    for (const name of PI_PACKAGES) {
      expect(manifest.dependencies[name], `${relative}: ${name}`).toBe('1.4.0')
    }
  }
})
