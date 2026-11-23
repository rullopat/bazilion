import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { markWords } from '../src/components/JumpPalette.tsx'

test('the words a search found are set apart in a result, whatever their case', () => {
  const html = renderToStaticMarkup(
    createElement(
      Fragment,
      null,
      ...markWords('Dark mode is in. The dark theme…', ['dark', 'mode']),
    ),
  )
  expect(html).toBe(
    '<strong class="font-semibold text-foreground">Dark</strong> <strong class="font-semibold text-foreground">mode</strong> is in. The <strong class="font-semibold text-foreground">dark</strong> theme…',
  )
  expect(markWords('a (b) c', ['(b)'])).toHaveLength(3)
})
