import { afterEach, expect, test, vi } from 'vitest'
import { translatePiEvent } from '../../daemon/src/runtime/pi/events.ts'
import { type PrintState, printEvent, unprintedProgress } from '../src/commands/agent-chat.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

test('live tool output prints each complete line once, even as the tail slides', () => {
  let printed = ''
  const lines: string[] = []
  for (const output of ['a\nb', 'a\nb\nc\n', 'b\nc\nd\ne\n', 'd\ne\nf']) {
    const next = unprintedProgress(printed, output)
    printed = next.complete
    lines.push(...next.fresh.split('\n').slice(0, -1))
  }
  expect(lines).toEqual(['a', 'b', 'c', 'd', 'e'])
})

test('every line of a long command prints once after its output outgrows the live tail', () => {
  // The daemon's tail of the cumulative output would otherwise start mid-line.
  let output = ''
  let printed = ''
  const expected: string[] = []
  const lines: string[] = []
  const update = () => {
    const [event] = translatePiEvent({
      type: 'tool_execution_update',
      toolCallId: 'call-1',
      toolName: 'bash',
      args: {},
      partialResult: { content: [{ type: 'text', text: output }] },
    } as Parameters<typeof translatePiEvent>[0])
    if (event?.type !== 'tool_progress') return
    const next = unprintedProgress(printed, event.output)
    printed = next.complete
    lines.push(...next.fresh.split('\n').slice(0, -1))
  }
  for (let i = 0; i < 1000; i++) {
    const line = `line ${i} ${'.'.repeat(i % 37)}`
    expected.push(line)
    output += `${line}\n`
    if (i % 7 === 6) update()
  }
  update()
  expect(output.length).toBeGreaterThan(3 * 8 * 1024)
  expect(lines).toEqual(expected)
})

test('tool output reaches the terminal without its control characters', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const state: PrintState = { inDeltaStream: false, progress: new Map() }
  printEvent(
    { type: 'tool_progress', id: 'call-1', name: 'bash', output: '\u001b[2Jcleared\tok\r\n' },
    state,
  )
  printEvent(
    { type: 'tool_result', id: 'call-1', name: 'bash', result: '\u001b]0;title\u0007' },
    state,
  )
  printEvent({ type: 'tool_error', id: 'call-2', name: 'bash', error: 'failed\n\u009b31m' }, state)
  expect(log.mock.calls).toEqual([
    ['  | \\x1b[2Jcleared\tok\\x0d'],
    ['  [result: \\x1b]0;title\\x07]'],
    ['  [tool error: bash — failed\n\\x9b31m]'],
  ])
})
