// Tests for the SSRF-validating forward proxy. The validation seam
// (_resolveSafeIpForTest) is checked directly; the live proxy is exercised
// with a real CONNECT to a private target, which must be refused.

import { connect as netConnect } from 'node:net'
import { afterAll, expect, test } from 'vitest'
import { _resolveSafeIpForTest, closeSsrfProxy, getSsrfProxy } from '../../src/lib/browser/proxy.ts'

afterAll(async () => {
  await closeSsrfProxy()
})

test('resolveSafeIp blocks private IP literals + loopback names', async () => {
  await expect(_resolveSafeIpForTest('127.0.0.1')).rejects.toThrow(/private IP literal/)
  await expect(_resolveSafeIpForTest('10.1.2.3')).rejects.toThrow(/private IP literal/)
  await expect(_resolveSafeIpForTest('localhost')).rejects.toThrow(/blocked hostname/)
})

test('resolveSafeIp returns a public IP literal unchanged', async () => {
  expect(await _resolveSafeIpForTest('1.1.1.1')).toBe('1.1.1.1')
})

test('proxy refuses a CONNECT to a private host', async () => {
  const url = new URL(await getSsrfProxy())
  const reply = await new Promise<string>((resolve, reject) => {
    const sock = netConnect(Number(url.port), url.hostname, () => {
      sock.write('CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1:443\r\n\r\n')
    })
    let buf = ''
    sock.on('data', (d) => {
      buf += d.toString('utf8')
      if (buf.includes('\r\n')) {
        resolve(buf.split('\r\n')[0] ?? '')
        sock.destroy()
      }
    })
    sock.on('error', reject)
    setTimeout(() => reject(new Error('timeout')), 5000)
  })
  expect(reply).toMatch(/403/)
})
