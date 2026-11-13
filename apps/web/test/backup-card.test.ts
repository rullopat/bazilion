import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { BackupCard } from '../src/components/BackupCard.tsx'

test('the backup card downloads the daemon archive', () => {
  const html = renderToStaticMarkup(createElement(BackupCard))
  expect(html).toContain('href="/api/backup"')
  expect(html).toContain('download=""')
})
