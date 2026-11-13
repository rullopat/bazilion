import type { HealthReport } from '@bazilion/api-types'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { RuntimeCard } from '../src/components/RuntimeCard.tsx'

const host = {
  ok: true,
  sandboxMode: 'off',
  approvalMode: 'dangerous',
  sandboxImage: 'debian:bookworm-slim',
  hostCodingTools: true,
  network: 'host',
  docker: null,
} satisfies HealthReport['shellSecurity']

function render(shell: HealthReport['shellSecurity']): string {
  return renderToStaticMarkup(createElement(RuntimeCard, { shell }))
}

/** The card's rows, label to value, in order. */
function rows(shell: HealthReport['shellSecurity']): Record<string, string> {
  return Object.fromEntries(
    Array.from(render(shell).matchAll(/<dt[^>]*>(.*?)<\/dt><dd[^>]*>(.*?)<\/dd>/g), (match) => [
      match[1],
      match[2],
    ]),
  )
}

test('host mode shows the sandbox and approval rows without Docker details', () => {
  const card = rows(host)
  expect(Object.keys(card)).toEqual(['Sandbox', 'Dangerous-command approval'])
  expect(card.Sandbox).not.toContain(host.sandboxImage)
  expect(card['Dangerous-command approval']).toMatch(/^On/)
})

test('Docker mode shows the image, readiness and remediation only when Docker needs it', () => {
  const unavailable = rows({
    ...host,
    sandboxMode: 'docker',
    approvalMode: 'off',
    hostCodingTools: false,
    network: 'none',
    docker: {
      ready: false,
      image: 'debian:bookworm-slim',
      reason: 'Docker socket is unavailable',
      remediation: 'Start the local Docker daemon.',
    },
  })
  expect(Object.keys(unavailable)).toEqual([
    'Sandbox',
    'Docker',
    'Remediation',
    'Dangerous-command approval',
  ])
  expect(unavailable.Sandbox).toContain('debian:bookworm-slim')
  expect(unavailable.Docker).toContain('Docker socket is unavailable')
  expect(unavailable.Remediation).toBe('Start the local Docker daemon.')
  expect(unavailable['Dangerous-command approval']).toBe('Off')

  const ready = rows({
    ...host,
    sandboxMode: 'docker',
    docker: { ready: true, image: 'debian:bookworm-slim', reason: null, remediation: null },
  })
  expect(Object.keys(ready)).toEqual(['Sandbox', 'Docker', 'Dangerous-command approval'])
  expect(ready.Docker).toBe('Ready')
})

test('an invalid shell-security configuration is reported, not hidden', () => {
  const html = render({ ok: false, error: 'unknown sandbox mode: podman' })
  expect(html).toContain('role="alert"')
  expect(html).toContain('unknown sandbox mode: podman')
  expect(html).not.toContain('<dl')
})
