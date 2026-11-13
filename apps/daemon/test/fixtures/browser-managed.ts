// Fixtures for the real-browser tests: a loopback HTTP origin that records every
// request it gets, and a lookup of the processes running on a browser profile.

import { readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface InstrumentedOrigin {
  origin: string
  /** Every request path the origin received. */
  hits: string[]
  close(): Promise<void>
}

const PAGES: Record<string, string> = {
  '/sw-page': `<!doctype html><title>sw-probe</title><p>service worker probe</p><script>
navigator.serviceWorker.register('/sw.js', { scope: '/sw-scope/' }).then(
  () => { document.title = 'SW-RESOLVED' },
  (e) => { document.title = 'SW-REJECTED:' + e.name },
)</script>`,
  '/download-page': `<!doctype html><title>download-probe</title><a id="dl" href="/file.bin" download>download</a>`,
}

// The worker answers every request in its scope itself, after trying one fetch
// of its own: that fetch must still go through the browser's proxy.
const SERVICE_WORKER = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  event.respondWith((async () => {
    let result = 'network-blocked';
    try { result = 'network-status:' + (await fetch('/worker-private-fetch')).status } catch {}
    return new Response('<body>persisted-worker-active ' + result + '</body>', { headers: { 'content-type': 'text/html' } });
  })());
});`

export async function createInstrumentedOrigin(): Promise<InstrumentedOrigin> {
  const hits: string[] = []
  const server = createServer((req, res) => {
    hits.push(req.url ?? '')
    if (req.url === '/sw.js') {
      res.writeHead(200, { 'content-type': 'application/javascript' }).end(SERVICE_WORKER)
    } else if (req.url === '/file.bin') {
      res
        .writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-disposition': 'attachment; filename="probe.bin"',
        })
        .end('probe-download-bytes')
    } else {
      const page = PAGES[req.url ?? '']
      res.writeHead(200, { 'content-type': page ? 'text/html' : 'text/plain' })
      res.end(page ?? 'instrumented origin')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

/** Pids of the processes started on a profile (the browser and its helpers). */
export function browserProcesses(userDataDir: string): number[] {
  return readdirSync('/proc')
    .filter((entry) => /^\d+$/.test(entry))
    .filter((pid) => {
      try {
        return readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(
          `--user-data-dir=${userDataDir}`,
        )
      } catch {
        return false
      }
    })
    .map(Number)
}
