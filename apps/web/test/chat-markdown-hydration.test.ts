import type { ProviderMessage } from '@bazilion/api-types'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ChatPane } from '../src/components/ChatPane.tsx'
import { renderMd } from '../src/lib/md.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('chat Markdown hydration', () => {
  test('keeps the escaped fallback when a DOM exists but hydration is not complete', () => {
    vi.stubGlobal('window', {})

    expect(renderMd('Hello **world**\n<img src=x onerror=alert(1)>', false)).toBe(
      'Hello **world**\n&lt;img src=x onerror=alert(1)&gt;',
    )
  })

  test('server-renders persisted assistant Markdown as the hydration fallback', () => {
    const initialMessages: ProviderMessage[] = [
      { role: 'user', content: 'Show me Markdown' },
      {
        role: 'assistant',
        content: 'Persisted **assistant** output\n<script>alert(1)</script>',
      },
    ]

    const html = renderToString(
      createElement(ChatPane, {
        agentId: 'agent-1',
        agentName: 'Tour Guide',
        initialMessages,
      }),
    )

    expect(html).toContain('Persisted **assistant** output')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<strong>assistant</strong>')
    expect(html).not.toContain('<script>alert(1)</script>')
  })
})
