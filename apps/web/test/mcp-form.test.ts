import { expect, test } from 'vitest'
import { EMPTY_MCP_DRAFT, type McpDraft, mcpServerForm, serversState } from '../src/lib/mcp-form.ts'

const draft = (more: Partial<McpDraft>): McpDraft => ({ ...EMPTY_MCP_DRAFT, ...more })

test('nothing typed: nothing to add and nothing to complain about', () => {
  expect(mcpServerForm(EMPTY_MCP_DRAFT)).toEqual({ problems: {}, missing: null, body: null })
})

test('a stdio server needs a name and a command, and sends its arguments split', () => {
  expect(mcpServerForm(draft({ name: 'files' }))).toEqual({
    problems: {},
    missing: 'A stdio server needs a name and a command.',
    body: null,
  })
  expect(mcpServerForm(draft({ command: 'npx' })).missing).toBe(
    'A stdio server needs a name and a command.',
  )
  expect(
    mcpServerForm(
      draft({ name: ' files ', command: ' npx ', args: ' -y  @scope/server /srv/data ' }),
    ),
  ).toEqual({
    problems: {},
    missing: null,
    body: {
      name: 'files',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@scope/server', '/srv/data'],
      url: null,
      authToken: undefined,
    },
  })
  // What was typed for the other transport is not sent.
  expect(
    mcpServerForm(draft({ name: 'files', command: 'npx', url: 'https://x.test/mcp', token: 't' }))
      .body,
  ).toMatchObject({ url: null, authToken: undefined })
})

test('an http server needs a name and an address the daemon accepts', () => {
  const http = (more: Partial<McpDraft>) => mcpServerForm(draft({ transport: 'http', ...more }))
  expect(http({ name: 'docs' }).missing).toBe('An http server needs a name and a URL.')
  expect(http({ name: 'docs', url: ' https://mcp.example.com/mcp ', token: 'secret' })).toEqual({
    problems: {},
    missing: null,
    body: {
      name: 'docs',
      transport: 'http',
      command: null,
      args: [],
      url: 'https://mcp.example.com/mcp',
      authToken: 'secret',
    },
  })
  expect(http({ name: 'docs', url: 'http://127.0.0.1:8080/mcp' }).body?.authToken).toBeUndefined()

  for (const [url, problem] of [
    ['mcp.example.com/mcp', 'An http:// or https:// address.'],
    ['ftp://mcp.example.com', 'An http:// or https:// address.'],
    [
      'https://me:secret@mcp.example.com/mcp',
      'No user name or password in the address: a token goes in the field beside it.',
    ],
    ['https://mcp.example.com/mcp#tools', 'An address without a # part.'],
  ] as const) {
    expect(http({ name: 'docs', url })).toEqual({
      problems: { url: problem },
      missing: null,
      body: null,
    })
  }
})

test('the name becomes part of every tool’s name, so it is letters, digits and underscores', () => {
  for (const name of ['my server', 'foo-bar', 'café', 'a.b']) {
    const form = mcpServerForm(draft({ name, command: 'npx' }))
    expect(form.problems.name).toBe(
      'Letters, digits and underscores only: its tools are named after it.',
    )
    expect(form.body).toBeNull()
  }
  expect(mcpServerForm(draft({ name: 'Play_wright2', command: 'npx' })).body?.name).toBe(
    'Play_wright2',
  )
})

test('the Servers card says how many are offered to Agents', () => {
  const on = { enabled: true }
  const off = { enabled: false }
  expect(serversState([])).toBeNull()
  expect(serversState([on])).toEqual({ label: '1 server on', tone: 'success' })
  expect(serversState([on, on])).toEqual({ label: '2 servers on', tone: 'success' })
  expect(serversState([on, off, off])).toEqual({ label: '1 of 3 on', tone: 'success' })
  expect(serversState([off, off])).toEqual({ label: 'None on', tone: 'neutral' })
})
