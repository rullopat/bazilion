import type { PlatformCapabilitiesReport } from '@bazilion/api-types'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { InstallationReadinessCard } from '../src/components/InstallationReadinessCard.tsx'

// Wire-only fixture: web never imports daemon internals, including for diagnostics.
const platformCapabilities: PlatformCapabilitiesReport = {
  platform: 'macOS',
  note: 'Platform support only, not an execution or connectivity test.',
  capabilities: [
    { id: 'ordinary_chat', label: 'Ordinary interactive chat', support: 'supported', detail: 'No chat was run by this report.' },
    { id: 'git_inspection', label: 'Hardened Git inspection', support: 'supported', detail: 'Uses a bounded private worktree capture. Unsafe layouts and capture limits still refuse inspection.' },
    { id: 'mcp_stdio', label: 'MCP stdio', support: 'unsupported', detail: 'Requires Linux process-tree retirement. Use Streamable HTTP instead.' },
    { id: 'mcp_http', label: 'MCP Streamable HTTP', support: 'supported', detail: 'Enable and test a configured server separately; protected turns still deny MCP.' },
  ],
}

test.each([
  [true, false],
  [false, false],
  [true, true],
  [false, true],
])('web keeps install health %s independent of protected baseline %s', (ok, protectedWorkBaselineReady) => {
  const html = renderToStaticMarkup(createElement(InstallationReadinessCard, {
    report: { ok, protectedWorkBaselineReady, platformCapabilities },
  }))
  expect(html).toContain(ok ? 'Healthy' : 'Issues found')
  expect(html).toContain('Structural checks only')
  expect(html).toContain('Ordinary chat execution')
  expect(html).toContain('Not checked')
  expect(html).toContain(protectedWorkBaselineReady ? 'Ready · per-turn checks still apply' : 'Unavailable')
  expect(html).toContain('protected turns never fall back to host execution')
  expect(html).toContain('not an execution or connectivity test')
  expect(html).not.toContain('all good')
})

test('macOS presentation admits bounded Git and retains the portable MCP alternative', () => {
  const html = renderToStaticMarkup(createElement(InstallationReadinessCard, {
    report: { ok: true, protectedWorkBaselineReady: false, platformCapabilities },
  }))
  expect(html).toContain('Daemon platform: macOS')
  expect(html.match(/Unsupported on this platform/g)).toHaveLength(1)
  expect(html.match(/Supported on this platform/g)).toHaveLength(3)
  for (const capability of platformCapabilities.capabilities) {
    expect(html).toContain(capability.label)
    expect(html).toContain(capability.detail)
  }
  expect(html).toContain('Use Streamable HTTP instead')
  expect(html).toContain('protected turns still deny MCP')
})

test('unsupported platforms cannot inherit supported capability labels', () => {
  const html = renderToStaticMarkup(createElement(InstallationReadinessCard, {
    report: {
      ok: true,
      protectedWorkBaselineReady: false,
      platformCapabilities: {
        ...platformCapabilities,
        platform: 'Unsupported platform',
        capabilities: platformCapabilities.capabilities.map((c) => ({ ...c, support: 'unsupported' })),
      },
    },
  }))
  expect(html).toContain('Daemon platform: Unsupported platform')
  expect(html.match(/Unsupported on this platform/g)).toHaveLength(4)
  expect(html).not.toContain('Supported on this platform')
})
