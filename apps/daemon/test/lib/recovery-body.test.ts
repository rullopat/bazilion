import { expect, test, vi } from 'vitest'
import { emptyRecoveryBody } from '../../src/lib/coding-environment/recovery-body.ts'

test('body-free recovery requires actual EOF, not a forged zero length', async () => {
  expect(await emptyRecoveryBody(new Request('http://fixture.invalid', { method: 'POST' }))).toBe(
    true,
  )
  expect(
    await emptyRecoveryBody(
      new Request('http://fixture.invalid', { method: 'POST', headers: { 'content-length': '1' } }),
    ),
  ).toBe(false)
  expect(
    await emptyRecoveryBody(
      new Request('http://fixture.invalid', {
        method: 'POST',
        headers: { 'content-length': '0' },
        body: 'force',
      }),
    ),
  ).toBe(false)
})

test('recovery refuses a stalled body or exhausted empty chunks without buffering', async () => {
  const empty = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(0))
    },
  })
  expect(
    await emptyRecoveryBody(
      new Request('http://fixture.invalid', {
        method: 'POST',
        body: empty,
        duplex: 'half',
      } as RequestInit),
    ),
  ).toBe(false)
  vi.useFakeTimers()
  try {
    const stalled = new ReadableStream<Uint8Array>({})
    const result = emptyRecoveryBody(
      new Request('http://fixture.invalid', {
        method: 'POST',
        body: stalled,
        duplex: 'half',
      } as RequestInit),
    )
    await vi.advanceTimersByTimeAsync(1001)
    expect(await result).toBe(false)
    expect(stalled.locked).toBe(false)
  } finally {
    vi.useRealTimers()
  }
})

test('nonempty recovery body owns asynchronous cancellation before returning refusal', async () => {
  let release!: () => void
  const cancel = new Promise<void>((resolve) => {
    release = resolve
  })
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1]))
    },
    cancel: () => cancel,
  })
  const request = new Request('http://fixture.invalid', {
    method: 'POST',
    body: stream,
    duplex: 'half',
  } as RequestInit)
  let settled = false
  const result = emptyRecoveryBody(request).then((value) => {
    settled = true
    return value
  })
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(settled).toBe(false)
  release()
  expect(await result).toBe(false)
  expect(stream.locked).toBe(false)
})
