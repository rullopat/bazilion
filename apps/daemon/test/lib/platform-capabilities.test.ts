import { expect, test } from 'vitest'
import { projectPlatformCapabilities } from '../../src/lib/platform-capabilities.ts'

test.each([
  ['linux', 'Linux', ['supported', 'supported', 'supported', 'supported']],
  ['darwin', 'macOS', ['supported', 'unsupported', 'unsupported', 'supported']],
  ['win32', 'Unsupported platform', ['unsupported', 'unsupported', 'unsupported', 'unsupported']],
  ['freebsd', 'Unsupported platform', ['unsupported', 'unsupported', 'unsupported', 'unsupported']],
] as const)('platform support projection is explicit for %s', (platform, label, support) => {
  const report = projectPlatformCapabilities(platform)
  expect(report.platform).toBe(label)
  expect(report.capabilities.map((c) => c.id)).toEqual([
    'ordinary_chat',
    'git_inspection',
    'mcp_stdio',
    'mcp_http',
  ])
  expect(report.capabilities.map((c) => c.support)).toEqual(support)
  expect(report.note).toContain('not an execution or connectivity test')
  expect(report.note).toContain('Every turn still validates')
  expect(report.capabilities.every((c) => c.detail.length > 0)).toBe(true)
})

test('macOS explains independent Linux-only refusals and the HTTP alternative', () => {
  const report = projectPlatformCapabilities('darwin')
  expect(report.capabilities[1]?.detail).toContain('ordinary chat does not grant this capability')
  expect(report.capabilities[2]?.detail).toContain('Use Streamable HTTP instead')
  expect(report.capabilities[3]?.detail).toContain('protected turns still deny MCP')
})

test('unknown platforms fail closed without reflecting arbitrary input', () => {
  const report = projectPlatformCapabilities('untrusted-platform-sentinel')
  expect(report.capabilities.every((c) => c.support === 'unsupported')).toBe(true)
  expect(JSON.stringify(report)).not.toContain('untrusted-platform-sentinel')
  expect(projectPlatformCapabilities()).toEqual(projectPlatformCapabilities(process.platform))
})
