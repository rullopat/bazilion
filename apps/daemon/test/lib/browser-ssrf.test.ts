import { expect, test } from 'vitest'
import { browserBlockReason } from '../../src/lib/browser/ssrf.ts'

test('blocks loopback IP literal', async () => {
  expect(await browserBlockReason('http://127.0.0.1/x', false)).toMatch(/private IP literal/)
})

test('blocks private IP literals', async () => {
  expect(await browserBlockReason('http://10.0.0.5/', false)).toBeTruthy()
  expect(await browserBlockReason('http://192.168.1.1/', false)).toBeTruthy()
  expect(await browserBlockReason('http://169.254.1.1/', false)).toBeTruthy()
})

test('blocks localhost + .local hostnames', async () => {
  expect(await browserBlockReason('http://localhost:3000/', false)).toMatch(/blocked hostname/)
  expect(await browserBlockReason('http://printer.local/', false)).toMatch(/blocked hostname/)
})

test('allowPrivate short-circuits the guard', async () => {
  expect(await browserBlockReason('http://127.0.0.1/x', true)).toBeNull()
  expect(await browserBlockReason('http://localhost/x', true)).toBeNull()
})

test('non-http schemes are always allowed', async () => {
  expect(await browserBlockReason('data:text/html,<p>hi', false)).toBeNull()
  expect(await browserBlockReason('about:blank', false)).toBeNull()
})

test('malformed URLs are left for Playwright to reject', async () => {
  expect(await browserBlockReason('not a url', false)).toBeNull()
})
