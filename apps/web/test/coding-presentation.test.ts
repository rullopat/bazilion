import { expect, test } from 'vitest'
import { codingFailureSummary, inboxUpdateLabel } from '../src/lib/coding-presentation.ts'

test('failure excerpt exposes the missing dependency without its stack trace', () => {
  expect(codingFailureSummary('✖ test failed\n  Error: Cannot find module \'fixture-dep\'\nRequire stack:\n- /workspace/app/test.cjs')).toBe("Error: Cannot find module 'fixture-dep'")
  expect(codingFailureSummary('All tests passed')).toBeNull()
  expect(codingFailureSummary(`Error: ${'x'.repeat(500)}`)?.length).toBeLessThanOrEqual(240)
})
test('inbox summary hides runtime instructions and opaque identifiers', () => {
  const id = '541fd306-6a08-4071-8bac-e299fad86aaf'
  expect(inboxUpdateLabel(`You have 1 new message\n--- from demo-tester (${id}) (message ${id}, reply to ${id}) ---\nResult\nYou MUST reply`)).toBe('Update from demo-tester')
  expect(inboxUpdateLabel(`--- from ${id} (message ${id}) ---`)).toBe('Teammate update received')
  expect(inboxUpdateLabel('Unrecognized runtime message')).toBe('Teammate update received')
})

test('failure details render an escaped error outside the collapsed output', async () => {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { CodingToolResult } = await import('../src/components/CodingToolResult.tsx')
  const html = renderToStaticMarkup(createElement(CodingToolResult, {
    name: 'coding_command',
    body: JSON.stringify({ state: 'failed', exitCode: 1, input: {command:'pnpm test',cwd:'app',purpose:'test'}, environment:{posture:'docker'}, diagnostic:"Error: Cannot find module '<script>fixture</script>'",id:'example',truncated:false }),
  }))
  expect(html).toContain('aria-label="Command failure summary"')
  expect(html.indexOf('Command failure summary')).toBeLessThan(html.indexOf('<details>'))
  expect(html).toContain('&lt;script&gt;')
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('<details open')
})
