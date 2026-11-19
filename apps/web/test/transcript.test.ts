import type { Agent, ProviderMessage, ResolvedAgent, Team } from '@bazilion/api-types'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'

// Links render as plain anchors: these tests are about the transcript, not the router.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, search }: { children: ReactNode; search?: Record<string, unknown> }) =>
    createElement(
      'a',
      {
        href: `/?${new URLSearchParams(
          Object.entries(search ?? {}).filter((entry): entry is [string, string] => {
            return typeof entry[1] === 'string'
          }),
        )}`,
      },
      children,
    ),
}))

import { projectMessages } from '../src/components/chat/entries.ts'
import { TranscriptBlocks } from '../src/components/chat/Transcript.tsx'
import { WorkspaceProvider } from '../src/components/workspace/context.tsx'

const team = { id: 'launch', name: 'Launch', policyMode: 'restricted' } as Team
const agent = (id: string, name: string) =>
  ({ id, name, teamId: 'launch', status: 'idle' }) as Agent
const agents = [agent('dev', 'Dev'), agent('pixel', 'Pixel')]

const call = (id: string, name: string, args: unknown) => ({
  id,
  name,
  arguments: JSON.stringify(args),
})

const history: ProviderMessage[] = [
  { role: 'user', content: 'Add dark mode and ask Pixel for a cover.' },
  {
    role: 'assistant',
    content: 'On it.',
    toolCalls: [
      call('t1', 'bash', { command: 'ls site' }),
      call('t2', 'write', { path: 'site/theme.js', content: 'a\nb\n' }),
      call('t3', 'send_message', { to: 'pixel', text: 'We need a cover image.' }),
    ],
  },
  { role: 'tool', toolCallId: 't1', toolName: 'bash', content: 'index.html' },
  { role: 'tool', toolCallId: 't2', toolName: 'write', content: 'ok' },
  { role: 'tool', toolCallId: 't3', toolName: 'send_message', content: 'sent' },
  { role: 'assistant', content: 'Done.' },
]

function render(inWorkspace: boolean): string {
  const blocks = createElement(TranscriptBlocks, {
    entries: projectMessages(history),
    markdownReady: false,
  })
  if (!inWorkspace) return renderToStaticMarkup(blocks)
  return renderToStaticMarkup(
    createElement(WorkspaceProvider, {
      value: {
        agents,
        teams: [team],
        profiles: [],
        teamTemplates: [],
        agent: { agent: agents[0], team } as ResolvedAgent,
        team,
        conversationId: 'c1',
        search: { agent: 'dev' },
      },
      // biome-ignore lint/correctness/noChildrenProp: createElement types want it in the props.
      children: blocks,
    }),
  )
}

test('a turn reads as steps in words, a hand-off card and the way to the diff', () => {
  const html = render(true)
  // Steps say what was done; the raw JSON arguments are not the label.
  expect(html).toContain('2 steps')
  expect(html).toContain('1 command, 1 file written')
  expect(html).toContain('Ran')
  expect(html).toContain('ls site')
  expect(html).toContain('Wrote')
  expect(html).toContain('+2')
  expect(html).not.toContain('{&quot;command&quot;')
  // The message to a teammate is a card naming the teammate, not a step.
  expect(html).toContain('Handed off to a teammate')
  expect(html).toContain('Pixel')
  expect(html).toContain('We need a cover image.')
  expect(html).not.toContain('3 steps')
  // Written files lead to the Changes tab on the first of them.
  expect(html).toContain('1 file written')
  expect(html).toContain('Review changes')
  expect(html).toContain('panel=changes')
  expect(html).toContain('file=site%2Ftheme.js')
})

test('outside the workspace the same transcript renders without its links', () => {
  const html = render(false)
  expect(html).toContain('Handed off to a teammate')
  expect(html).toContain('1 file written')
  expect(html).not.toContain('Review changes')
  expect(html).not.toContain('See connections')
})
