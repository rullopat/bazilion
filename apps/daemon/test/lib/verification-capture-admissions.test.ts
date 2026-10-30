import { expect, test, vi } from 'vitest'
import { createNativeCaptureAdmissions } from '../../src/lib/verification/capture-admissions.ts'

test('capture shutdown fences synchronously, aborts actual lifetime and drains cleanup before settling', async () => {
  const admissions = createNativeCaptureAdmissions()
  let aborted = false,
    finished = false,
    release = () => {}
  const cleanup = new Promise<void>((resolve) => {
    release = resolve
  })
  const active = admissions.run(undefined, async (signal) => {
    await new Promise<void>((resolve) =>
      signal.addEventListener(
        'abort',
        () => {
          aborted = true
          resolve()
        },
        { once: true },
      ),
    )
    await cleanup
    finished = true
    return 'finished'
  })
  const stopping = admissions.stop()
  expect(aborted).toBe(true)
  expect(admissions.stop()).toBe(stopping)
  const denied = vi.fn(async () => undefined)
  await expect(admissions.run(undefined, denied)).rejects.toThrow('stopping')
  expect(denied).not.toHaveBeenCalled()
  await Promise.resolve()
  expect(finished).toBe(false)
  release()
  expect(await active).toBe('finished')
  await stopping
  expect(finished).toBe(true)
})
test('pre-aborted capture never enters work; failed work cannot remain an active admission', async () => {
  const admissions = createNativeCaptureAdmissions(),
    abort = new AbortController()
  abort.abort()
  const task = vi.fn(async () => undefined)
  await expect(admissions.run(abort.signal, task)).rejects.toThrow()
  expect(task).not.toHaveBeenCalled()
  await expect(
    admissions.run(undefined, async () => {
      throw new Error('controlled')
    }),
  ).rejects.toThrow('controlled')
  await admissions.stop()
})
test('capture admission is bounded and shutdown never invents cleanup for outstanding tasks', async () => {
  const admissions = createNativeCaptureAdmissions(),
    releases: Array<() => void> = []
  const pending = Array.from({ length: 256 }, () =>
    admissions.run(undefined, () => new Promise<void>((resolve) => releases.push(resolve))),
  )
  const extra = vi.fn(async () => undefined)
  await expect(admissions.run(undefined, extra)).rejects.toThrow('unavailable')
  expect(extra).not.toHaveBeenCalled()
  const stopped = admissions.stop()
  let settled = false
  void stopped.then(() => {
    settled = true
  })
  await Promise.resolve()
  expect(settled).toBe(false)
  for (const release of releases) release()
  await Promise.all(pending)
  await stopped
  expect(settled).toBe(true)
})
