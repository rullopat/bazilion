import { connect, isIP } from 'node:net'
import { afterAll, expect, test, vi } from 'vitest'

// DNS answers are scripted per host name; IP literals resolve to themselves.
const dnsAnswers = new Map<string, Array<{ address: string; family: number }>>()
vi.mock('node:dns/promises', () => ({
  lookup: async (host: string) => {
    if (isIP(host)) return [{ address: host, family: isIP(host) }]
    const answer = dnsAnswers.get(host)
    if (!answer) throw new Error(`ENOTFOUND ${host}`)
    return answer
  },
}))

const { closeSsrfProxy, getSsrfProxy, resolvePublicAddress } = await import(
  '../../src/lib/browser/proxy.ts'
)

afterAll(() => closeSsrfProxy())

/** Send a raw request to the proxy and return the first response line. */
async function firstLine(request: string): Promise<string> {
  const { port } = new URL(await getSsrfProxy())
  return new Promise((resolve, reject) => {
    const socket = connect(Number(port), '127.0.0.1', () => socket.write(request))
    let received = ''
    socket.on('data', (data) => {
      received += data.toString('utf8')
      if (received.includes('\r\n')) {
        resolve(received.split('\r\n')[0] ?? '')
        socket.destroy()
      }
    })
    socket.on('error', reject)
  })
}

test('private literals and loopback names are refused; public ones pass through', async () => {
  await expect(resolvePublicAddress('127.0.0.1')).rejects.toThrow(/private address/)
  await expect(resolvePublicAddress('[::1]')).rejects.toThrow(/private address/)
  await expect(resolvePublicAddress('10.1.2.3')).rejects.toThrow(/private address/)
  await expect(resolvePublicAddress('localhost')).rejects.toThrow(/blocked hostname/)
  await expect(resolvePublicAddress('1.1.1.1')).resolves.toBe('1.1.1.1')
})

test('a name is refused when any of its addresses is private (DNS rebinding)', async () => {
  dnsAnswers.set('public.example', [{ address: '93.184.216.34', family: 4 }])
  dnsAnswers.set('rebind.example', [
    { address: '93.184.216.34', family: 4 },
    { address: '192.168.1.10', family: 4 },
  ])
  await expect(resolvePublicAddress('public.example')).resolves.toBe('93.184.216.34')
  await expect(resolvePublicAddress('rebind.example')).rejects.toThrow(/resolves to private/)
})

test('the proxy answers 403 to CONNECT and plain requests for private targets', async () => {
  expect(await firstLine('CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1:443\r\n\r\n')).toMatch(
    /403/,
  )
  dnsAnswers.set('rebind.example', [{ address: '10.0.0.5', family: 4 }])
  expect(
    await firstLine('GET http://rebind.example/ HTTP/1.1\r\nHost: rebind.example\r\n\r\n'),
  ).toMatch(/403/)
})

test('a CONNECT to an impossible port gets 400 and the proxy keeps serving', async () => {
  // connect() throws synchronously on such a port; unanswered, the rejection
  // would be unhandled and exit the daemon.
  for (const target of ['1.1.1.1:99999', '1.1.1.1:65536', '1.1.1.1:0', '1.1.1.1:1234567']) {
    expect(await firstLine(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`)).toMatch(
      /^HTTP\/1\.1 400/,
    )
  }
  expect(await firstLine('CONNECT 10.0.0.1:443 HTTP/1.1\r\nHost: 10.0.0.1:443\r\n\r\n')).toMatch(
    /403/,
  )
})

test('concurrent first calls share one proxy', async () => {
  await closeSsrfProxy()
  const urls = await Promise.all([getSsrfProxy(), getSsrfProxy(), getSsrfProxy()])
  expect(new Set(urls).size).toBe(1)
})

test('closing cuts idle keep-alive clients instead of waiting for them', async () => {
  const { port } = new URL(await getSsrfProxy())
  const socket = connect(Number(port), '127.0.0.1')
  socket.on('error', () => {})
  socket.write('GET http://127.0.0.1/x HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n')
  await new Promise((resolve) => setTimeout(resolve, 200))
  const started = Date.now()
  await closeSsrfProxy()
  expect(Date.now() - started).toBeLessThan(1_000)
  expect(await getSsrfProxy()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
})
