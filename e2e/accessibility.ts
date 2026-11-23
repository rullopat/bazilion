// The automatic part of an accessibility check: axe-core's WCAG 2.1 A and AA rules on a page as
// it is, each failure named with the elements it was found on and why. axe is evaluated through
// the browser's debugging protocol, so the page's Content Security Policy does not stop it.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Page } from 'playwright'

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')

interface Violation {
  id: string
  impact: string | null
  help: string
  count: number
  nodes: string[]
}

// Run in the page, as text: this file is compiled without the browser's types.
const RUN = `(async () => {
  const result = await axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    resultTypes: ['violations'],
  })
  const line = (text) => (text || '').replace(/\\s+/g, ' ')
  return result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    count: violation.nodes.length,
    nodes: violation.nodes.slice(0, 3).map(
      (node) =>
        node.target.join(' ') + ' ' + line(node.html).slice(0, 160) +
        ' [' + line(node.failureSummary).slice(0, 200) + ']',
    ),
  }))
})()`

/** What axe finds wrong on the page, one line per rule; empty when it finds nothing. */
export async function accessibilityProblems(page: Page, where: string): Promise<string[]> {
  await page.evaluate(AXE)
  const violations = (await page.evaluate(RUN)) as Violation[]
  return violations.map(
    (violation) =>
      `${where}: ${violation.id} (${violation.impact}, ${violation.count}×) ${violation.help}: ${violation.nodes.join(' | ')}`,
  )
}
