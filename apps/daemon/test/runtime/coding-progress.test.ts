import { expect, test } from 'vitest'
import { CodingDiagnostics } from '../../src/lib/coding-environment/diagnostics.ts'
import { translatePiEvent } from '../../src/runtime/pi/events.ts'

function update(toolName: string, details: unknown) {
  return {
    type: 'tool_execution_update',
    toolCallId: 'call-1',
    toolName,
    args: {},
    partialResult: { content: [], details },
  } as never
}

test('coding tool updates become cumulative progress events', () => {
  const translated = translatePiEvent(
    update('coding_command', {
      codingProgress: {
        id: 'call-1',
        commandId: 'cmd-1',
        output: 'building…',
        truncated: false,
        elapsedMs: 1250,
      },
    }),
  )
  expect(translated).toEqual([
    {
      type: 'coding_progress',
      id: 'call-1',
      commandId: 'cmd-1',
      output: 'building…',
      truncated: false,
      elapsedMs: 1250,
    },
  ])
})

test('non-coding and malformed updates stay internal', () => {
  expect(translatePiEvent(update('bash', { codingProgress: { id: 'x' } }))).toEqual([])
  expect(translatePiEvent(update('coding_command', {}))).toEqual([])
  expect(
    translatePiEvent(
      update('coding_command', { codingProgress: { id: 'call-1', commandId: 'cmd-1' } }),
    ),
  ).toEqual([])
  expect(translatePiEvent(update('coding_command', { codingProgress: { output: 123 } }))).toEqual(
    [],
  )
})

test('live preview is redacted, bounded and does not finalize the diagnostics', () => {
  const output = new CodingDiagnostics(['SECRET_VALUE'])
  output.append(Buffer.from('prefix SECRET_'))
  output.append(Buffer.from('VALUE ' + 'x'.repeat(20000)))
  // A wide preview shows the whole retained buffer and the redaction.
  const wide = output.preview(30000)
  expect(wide.text).toContain('[redacted]')
  expect(wide.text).not.toContain('SECRET_VALUE')
  // A narrow preview is bounded to the byte limit and flags truncation.
  const bounded = output.preview(1024)
  expect(bounded.truncated).toBe(true)
  expect(Buffer.byteLength(bounded.text)).toBeLessThanOrEqual(1024)
  // preview does not seal: more output and a final finish remain available.
  output.append(Buffer.from('tail'))
  expect(output.finish().diagnostic).toContain('tail')
})
