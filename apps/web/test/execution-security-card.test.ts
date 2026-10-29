import type { ExecutionSecurityReport } from '@bazilion/api-types'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { ExecutionSecurityCard } from '../src/components/ExecutionSecurityCard.tsx'

const unavailable: ExecutionSecurityReport = {
  configuredOperatorHttp: {
    protected: false,
    codingSurface: 'host',
    dockerImage: 'debian:bookworm-slim',
    browser: 'enabled',
    mcp: 'enabled',
  },
  protectedUnattendedTurns: {
    baseRuntimeReady: false,
    codingSurface: 'docker',
    docker: {
      ready: false,
      image: 'debian:bookworm-slim',
      reason: 'Docker executable is unavailable',
    },
    browser: 'denied',
    mcp: 'denied',
    openaiCodex: {
      enabled: true,
      connected: false,
      accessCurrent: false,
      refreshOnNextTurn: false,
      baselineEligible: false,
    },
    remediation: 'Connect ChatGPT for OpenAI Codex on the Config page.',
  },
}

test('renders configured and protected execution postures without conflating them', () => {
  const html = renderToStaticMarkup(createElement(ExecutionSecurityCard, { status: unavailable }))

  expect(html).toContain('Configured operator HTTP')
  expect(html).toContain('trusted host · unisolated')
  expect(html).toContain('Trusted host tools (unisolated)')
  expect(html).toContain('Protected unattended turns')
  expect(html).toContain('Telegram, schedules, inbox wake-ups, and approval delivery')
  expect(html).toContain('base runtime unavailable')
  expect(html).toContain('Docker executable is unavailable')
  expect(html).toContain('OpenAI Codex baseline eligible')
  expect(html).toContain('Connect ChatGPT for OpenAI Codex on the Config page.')
  expect(html).toContain(
    'Every turn separately validates its selected normal/review model, bound OAuth refresh,',
  )
  expect(html).toContain('Operator requests only; unattended sources never select this branch')
  expect(html).not.toContain('background delivery')
  expect(html.match(/denied/g)).toHaveLength(2)
})

test('renders unsupported Mac protection without advertising a native or Docker readiness badge', () => {
  const status: ExecutionSecurityReport = {
    configuredOperatorHttp: {...unavailable.configuredOperatorHttp,dockerImage:null},
    protectedUnattendedTurns: {
      baseRuntimeReady:false,codingSurface:'unavailable',docker:null,browser:'denied',mcp:'denied',
      openaiCodex:unavailable.protectedUnattendedTurns.openaiCodex,
      remediation:'Native macOS isolation is deferred and unqualified; protected work has no host fallback.',
    },
  }
  const html=renderToStaticMarkup(createElement(ExecutionSecurityCard,{status}))
  expect(html).toContain('Trusted host tools (unisolated)')
  expect(html).toContain('Unavailable — no qualified isolation backend')
  expect(html).toContain('Refuses — no trusted-host fallback')
  expect(html).toContain('deferred and unqualified')
  expect(html).not.toContain('Docker image')
  expect(html).not.toContain('Native readiness')
  expect(html).not.toContain('base runtime ready')
})

test('renders a ready protected base runtime without remediation', () => {
  const status: ExecutionSecurityReport = {
    ...unavailable,
    protectedUnattendedTurns: {
      ...unavailable.protectedUnattendedTurns,
      baseRuntimeReady: true,
      docker: { ready: true, image: 'debian:bookworm-slim', reason: null },
      openaiCodex: {
        enabled: true,
        connected: true,
        accessCurrent: true,
        refreshOnNextTurn: false,
        baselineEligible: true,
      },
      remediation: null,
    },
  }
  const html = renderToStaticMarkup(createElement(ExecutionSecurityCard, { status }))

  expect(html).toContain('Protected unattended turns')
  expect(html).toContain('base runtime ready')
  expect(html).toContain('OpenAI access</dt><dd')
  expect(html).toContain('current')
  expect(html).not.toContain('Remediation:')
})

test('renders near-expiry OAuth as refresh-on-next-turn without losing baseline eligibility', () => {
  const status: ExecutionSecurityReport = {
    ...unavailable,
    protectedUnattendedTurns: {
      ...unavailable.protectedUnattendedTurns,
      baseRuntimeReady: true,
      docker: { ready: true, image: 'debian:bookworm-slim', reason: null },
      openaiCodex: {
        enabled: true,
        connected: true,
        accessCurrent: false,
        refreshOnNextTurn: true,
        baselineEligible: true,
      },
      remediation: null,
    },
  }
  const html = renderToStaticMarkup(createElement(ExecutionSecurityCard, { status }))

  expect(html).toContain('base runtime ready')
  expect(html).toContain('refresh on next turn')
  expect(html).not.toContain('Reconnect ChatGPT')
  expect(html).not.toContain('Remediation:')
})
