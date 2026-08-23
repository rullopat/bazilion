import { expect, test, vi } from 'vitest'
import { createProtectedDockerReadinessCache } from '../../src/lib/protected-docker-readiness-cache.ts'
import type { ProtectedDockerReadiness } from '../../src/runtime/shell/docker.ts'

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('shares the first deep probe across concurrent unauthenticated health requests', async () => {
  const pending = deferred<ProtectedDockerReadiness>()
  const probe = vi.fn(() => pending.promise)
  const cache = createProtectedDockerReadinessCache(100, () => 0)

  const requests = [
    cache.get('image:a', probe),
    cache.get('image:a', probe),
    cache.get('image:a', probe),
  ]
  expect(probe).toHaveBeenCalledTimes(1)
  pending.resolve({ ready: true, image: 'image:a' })
  await expect(Promise.all(requests)).resolves.toEqual([
    { ready: true, image: 'image:a' },
    { ready: true, image: 'image:a' },
    { ready: true, image: 'image:a' },
  ])
})

test('serves last-known readiness while exactly one expired refresh runs', async () => {
  let time = 0
  const cache = createProtectedDockerReadinessCache(100, () => time)
  const initial = vi.fn(
    async (): Promise<ProtectedDockerReadiness> => ({
      ready: true,
      image: 'image:a',
    }),
  )
  await expect(cache.get('image:a', initial)).resolves.toEqual({ ready: true, image: 'image:a' })

  time = 101
  const pending = deferred<ProtectedDockerReadiness>()
  const refresh = vi.fn(() => pending.promise)
  await expect(cache.get('image:a', refresh)).resolves.toEqual({ ready: true, image: 'image:a' })
  await expect(cache.get('image:a', refresh)).resolves.toEqual({ ready: true, image: 'image:a' })
  expect(refresh).toHaveBeenCalledTimes(1)

  pending.resolve({ ready: false, image: 'image:a', reason: 'Docker preflight failed' })
  await pending.promise
  await expect(cache.get('image:a', refresh)).resolves.toEqual({
    ready: false,
    image: 'image:a',
    reason: 'Docker preflight failed',
  })
  expect(refresh).toHaveBeenCalledTimes(1)
})

test('a configured-image change never reuses another image result', async () => {
  const cache = createProtectedDockerReadinessCache(100, () => 0)
  await cache.get('image:a', async () => ({ ready: true, image: 'image:a' }))
  const probe = vi.fn(
    async (): Promise<ProtectedDockerReadiness> => ({
      ready: false,
      image: 'image:b',
      reason: 'Docker image is unavailable',
    }),
  )

  await expect(cache.get('image:b', probe)).resolves.toEqual({
    ready: false,
    image: 'image:b',
    reason: 'Docker image is unavailable',
  })
  expect(probe).toHaveBeenCalledTimes(1)
})
