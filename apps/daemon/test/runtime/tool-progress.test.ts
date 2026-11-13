import type { SessionEvent } from '@bazilion/api-types'
import { expect, test, vi } from 'vitest'
import {
  paceToolProgress,
  piMessagesToProviderView,
  translatePiEvent,
} from '../../src/runtime/pi/events.ts'
import { envSecretValues } from '../../src/runtime/worker/runtime.ts'

function update(toolName: string, text: string | null) {
  return {
    type: 'tool_execution_update',
    toolCallId: 'call-1',
    toolName,
    args: {},
    partialResult: { content: text === null ? [] : [{ type: 'text', text }] },
  } as Parameters<typeof translatePiEvent>[0]
}

function end(text: string, isError = false) {
  return {
    type: 'tool_execution_end',
    toolCallId: 'call-1',
    toolName: 'bash',
    isError,
    result: { content: [{ type: 'text', text }] },
  } as Parameters<typeof translatePiEvent>[0]
}

test('partial results of any tool become cumulative progress events', () => {
  expect(translatePiEvent(update('bash', 'tick 1\ntick 2\n'))).toEqual([
    { type: 'tool_progress', id: 'call-1', name: 'bash', output: 'tick 1\ntick 2\n' },
  ])
  expect(translatePiEvent(update('mcp__docs__build', 'building…'))).toEqual([
    { type: 'tool_progress', id: 'call-1', name: 'mcp__docs__build', output: 'building…' },
  ])
  // Pi's opening empty update carries nothing to show.
  expect(translatePiEvent(update('bash', null))).toEqual([])
})

test('live output is redacted, holds back a credential prefix and keeps a bounded tail', () => {
  const secrets = ['SECRET_VALUE']
  const [whole] = translatePiEvent(update('bash', 'token=SECRET_VALUE\n'), secrets)
  expect(whole).toMatchObject({ output: 'token=[REDACTED]\n' })
  // The rest of the credential may only arrive with the next update.
  const [partial] = translatePiEvent(update('bash', 'ok\ntoken=SECRET_'), secrets)
  expect(partial).toMatchObject({ output: 'ok\ntoken=' })
  // A cut tail starts on a line boundary, so clients can line successive tails up.
  const lines = Array.from({ length: 1000 }, (_, i) => `line ${i}\n`).join('')
  const [tail] = translatePiEvent(update('bash', lines), secrets)
  const output = tail?.type === 'tool_progress' ? tail.output : ''
  expect(output.length).toBeLessThanOrEqual(8 * 1024)
  expect(output.length).toBeGreaterThan(8 * 1024 - 'line 999\n'.length)
  expect(output.startsWith('line ')).toBe(true)
  expect(lines.endsWith(output)).toBe(true)
  // Only a single line longer than the whole tail is cut mid-line.
  const [long] = translatePiEvent(update('bash', `end\n${'x'.repeat(20_000)}`), secrets)
  expect(long).toMatchObject({ output: 'x'.repeat(8 * 1024) })
  // Including one that ends with the output's final newline.
  const [ended] = translatePiEvent(update('bash', `${'x'.repeat(9000)}\n`), secrets)
  expect(ended).toMatchObject({ output: `${'x'.repeat(8 * 1024 - 1)}\n` })
})

test('live output is paced per tool call and the latest tail always precedes the result', () => {
  vi.useFakeTimers()
  try {
    const sent: SessionEvent[] = []
    const events = paceToolProgress((event) => sent.push(event), 400)
    const progress = (id: string, output: string): SessionEvent => ({
      type: 'tool_progress',
      id,
      name: 'bash',
      output,
    })
    events.send(progress('a', '1\n'))
    events.send(progress('a', '1\n2\n'))
    events.send(progress('b', 'other\n'))
    events.send(progress('a', '1\n2\n3\n'))
    expect(sent.map((e) => e.type === 'tool_progress' && e.output)).toEqual(['1\n', 'other\n'])
    vi.advanceTimersByTime(400)
    expect(sent.at(-1)).toEqual(progress('a', '1\n2\n3\n'))
    events.send(progress('a', '1\n2\n3\n4\n'))
    events.send({ type: 'tool_result', id: 'a', name: 'bash', result: '1\n2\n3\n4\n5\n' })
    expect(sent.slice(-2).map((e) => e.type)).toEqual(['tool_progress', 'tool_result'])
    expect(sent.at(-2)).toEqual(progress('a', '1\n2\n3\n4\n'))
    // What is still pending when the turn ends is dropped.
    events.send(progress('b', 'other\nmore\n'))
    events.send(progress('b', 'other\nmore\nlast\n'))
    events.stop()
    vi.advanceTimersByTime(1000)
    expect(sent.at(-1)).toEqual(progress('b', 'other\nmore\n'))
  } finally {
    vi.useRealTimers()
  }
})

test('tool results, errors and history are redacted with the same secrets', () => {
  const secrets = envSecretValues({
    OPENAI_CODEX_OAUTH: JSON.stringify({ access: 'ACCESS_VALUE', refresh: 'REFRESH_VALUE' }),
    PATH: '/usr/bin',
    // Short values are too common in ordinary output to redact.
    GUM_LOG_KEY_FOREGROUND: '#ffffff',
  })
  expect(secrets).toEqual(expect.arrayContaining(['ACCESS_VALUE', 'REFRESH_VALUE']))
  expect(secrets).not.toContain('#ffffff')
  // Only credential-shaped names and, inside JSON credentials, credential fields count.
  const vertex = JSON.stringify({
    type: 'service_account',
    private_key: 'PRIVATE_KEY_VALUE',
    token_uri: 'https://oauth2.googleapis.com/token',
  })
  const named = envSecretValues({
    GOOGLE_VERTEX_CREDENTIALS_JSON: vertex,
    MCP_TOKEN_SERVER1: 'MCP_BEARER_VALUE',
    AWS_SECRET_ACCESS_KEY: 'AWS_SECRET_VALUE',
    // A credential word glued to the rest of its part still counts.
    PGPASSWORD: 'PG_PASSWORD_VALUE',
    OPENAI_APIKEY: 'GLUED_API_KEY_VALUE',
    SMTP_PASSWD: 'SMTP_PASSWD_VALUE',
    GIT_AUTHOR_NAME: 'Operator Name',
    GIT_AUTHOR_EMAIL: 'operator@example.com',
    SSH_AUTH_SOCK: '/run/user/1000/ssh-agent.socket',
    XAUTHORITY: '/run/user/1000/xauth_abcdef',
    GNOME_KEYRING_CONTROL: '/run/user/1000/keyring',
  })
  expect(named.sort()).toEqual(
    [
      vertex,
      'PRIVATE_KEY_VALUE',
      'MCP_BEARER_VALUE',
      'AWS_SECRET_VALUE',
      'PG_PASSWORD_VALUE',
      'GLUED_API_KEY_VALUE',
      'SMTP_PASSWD_VALUE',
    ].sort(),
  )
  expect(JSON.stringify(translatePiEvent(end('printed ACCESS_VALUE'), secrets))).not.toContain(
    'ACCESS_VALUE',
  )
  expect(translatePiEvent(end('failed with REFRESH_VALUE', true), secrets)).toEqual([
    { type: 'tool_error', id: 'call-1', name: 'bash', error: 'failed with [REDACTED]' },
  ])
  const history = piMessagesToProviderView(
    [
      {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'bash',
        content: [{ type: 'text', text: 'echo ACCESS_VALUE\nACCESS_VALUE' }],
        isError: false,
        timestamp: 0,
      },
    ] as Parameters<typeof piMessagesToProviderView>[0],
    secrets,
  )
  expect(history).toMatchObject([
    { role: 'tool', toolName: 'bash', content: 'echo [REDACTED]\n[REDACTED]' },
  ])
})
