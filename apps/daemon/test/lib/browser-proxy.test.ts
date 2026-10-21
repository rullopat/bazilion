// Tests for the SSRF-validating forward proxy. The validation seam
// (_resolveSafeIpForTest) is checked directly; the live proxy is exercised
// with a real CONNECT to a private target, which must be refused.

import { connect as netConnect, type Socket } from 'node:net'
import { PassThrough } from 'node:stream'
import { afterAll, expect, test } from 'vitest'
import {
  _resolveSafeIpForTest,
  _setBindForTest,
  _setDialForTest,
  _setDnsLookupForTest,
  _trackedSocketCountForTest,
  closeSsrfProxy,
  getSsrfProxy,
  type ProxyBindFn,
  type UpstreamDialFn,
} from '../../src/lib/browser/proxy.ts'

afterAll(async () => {
  _setBindForTest(null)
  _setDialForTest(null)
  _setDnsLookupForTest(null)
  await closeSsrfProxy()
})

/** A raw client connection to the current proxy that records nothing. */
function connectToProxy(port: number): Socket {
  const sock = netConnect(port, '127.0.0.1')
  sock.on('error', () => {})
  return sock
}

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

test('getSsrfProxy is single-flight: concurrent first calls share one server', async () => {
  await closeSsrfProxy()
  const [a, b, c] = await Promise.all([getSsrfProxy(), getSsrfProxy(), getSsrfProxy()])
  expect(a).toBe(b)
  expect(b).toBe(c)
})

test('closeSsrfProxy settles within the D2 bound with lingering keep-alive clients', async () => {
  const url = new URL(await getSsrfProxy())
  // An absolute-form GET to a blocked loopback target is denied with 403, but
  // the client keeps the connection open (idle keep-alive) — exactly the
  // lingering-socket class that stalled the 2026-09-25 adapter lane teardown.
  const sock = netConnect(Number(url.port), url.hostname)
  sock.on('error', () => {})
  sock.write('GET http://127.0.0.1:443/x HTTP/1.1\r\nHost: 127.0.0.1:443\r\n\r\n')
  await new Promise<void>((resolve) => setTimeout(resolve, 300))

  const start = Date.now()
  await closeSsrfProxy()
  expect(Date.now() - start).toBeLessThan(2_000)
  sock.destroy()

  // And the proxy rebinds cleanly afterwards.
  const again = new URL(await getSsrfProxy())
  expect(again.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
})

test('a failed bind rejects every concurrent caller; a retry succeeds', async () => {
  await closeSsrfProxy()
  _setBindForTest(async () => {
    throw new Error('bind failed (test)')
  })
  const attempts = [getSsrfProxy(), getSsrfProxy(), getSsrfProxy()]
  for (const attempt of attempts) await expect(attempt).rejects.toThrow(/bind failed/)
  // The failed startup left nothing owned behind.
  expect(_trackedSocketCountForTest()).toBe(0)
  // And the next call binds cleanly.
  _setBindForTest(null)
  const url = new URL(await getSsrfProxy())
  expect(url.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
})

test('a close during startup fails closed instead of resurrecting the proxy', async () => {
  await closeSsrfProxy()
  const delayedBind: ProxyBindFn = async (server) => {
    await new Promise((r) => setTimeout(r, 300))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
  }
  _setBindForTest(delayedBind)
  const starting = getSsrfProxy()
  await new Promise((r) => setTimeout(r, 100))
  await closeSsrfProxy() // lands while the bind is still pending
  await expect(starting).rejects.toThrow(/closed while starting/)
  // Nothing owned, nothing listening.
  expect(_trackedSocketCountForTest()).toBe(0)
  // A later startup works normally.
  _setBindForTest(null)
  const url = new URL(await getSsrfProxy())
  expect(url.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
})

test('a pending DNS resolution spanning a close never dials an upstream', async () => {
  await closeSsrfProxy()
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => {
    release = r
  })
  _setDnsLookupForTest(async () => {
    await gate
    return [{ address: '192.0.2.1', family: 4 }]
  })
  const url = new URL(await getSsrfProxy())
  const sock = connectToProxy(Number(url.port))
  sock.write('GET http://pending.invalid/x HTTP/1.1\r\nHost: pending.invalid\r\n\r\n')
  await new Promise((r) => setTimeout(r, 200))
  // The proxied client socket is owned while the (gated) lookup is pending.
  expect(_trackedSocketCountForTest()).toBeGreaterThan(0)

  const start = Date.now()
  await closeSsrfProxy()
  expect(Date.now() - start).toBeLessThan(2_000)
  // Release the lookup: the closed generation must destroy the client side
  // and never dial the upstream — no socket may outlive the close.
  release()
  await new Promise((r) => setTimeout(r, 300))
  expect(_trackedSocketCountForTest()).toBe(0)
  _setDnsLookupForTest(null)
})

test('a half-open CONNECT tunnel is destroyed and close settles within the D2 bound', async () => {
  await closeSsrfProxy()
  // Fake an upstream that accepts the tunnel but never relays anything:
  // both sides stay open and idle — the half-open case.
  const fakeDial: UpstreamDialFn = (_port, _ip, onConnect) => {
    const fake = new PassThrough()
    queueMicrotask(() => onConnect())
    return fake as unknown as Socket
  }
  _setDialForTest(fakeDial)
  const url = new URL(await getSsrfProxy())
  const reply = await new Promise<string>((resolve, reject) => {
    const sock = netConnect(Number(url.port), '127.0.0.1', () => {
      sock.write('CONNECT 192.0.2.1:443 HTTP/1.1\r\nHost: 192.0.2.1:443\r\n\r\n')
    })
    let buf = ''
    sock.on('data', (d) => {
      buf += d.toString('utf8')
      if (buf.includes('\r\n')) {
        resolve(buf.split('\r\n')[0] ?? '')
        // keep the tunnel open on purpose
      }
    })
    sock.on('error', reject)
    setTimeout(() => reject(new Error('timeout')), 5000)
  })
  expect(reply).toMatch(/200/)
  expect(_trackedSocketCountForTest()).toBeGreaterThanOrEqual(2) // client + fake upstream

  const start = Date.now()
  await closeSsrfProxy()
  expect(Date.now() - start).toBeLessThan(2_000)
  expect(_trackedSocketCountForTest()).toBe(0)
  _setDialForTest(null)
})

test('rebinding still pins the validated IP: private targets stay denied', async () => {
  await closeSsrfProxy()
  const first = new URL(await getSsrfProxy())
  await closeSsrfProxy()
  const second = new URL(await getSsrfProxy())
  expect(second.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  expect(second.origin).not.toBe(first.origin) // a genuinely new listener
  const reply = await new Promise<string>((resolve, reject) => {
    const sock = netConnect(Number(second.port), '127.0.0.1', () => {
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
