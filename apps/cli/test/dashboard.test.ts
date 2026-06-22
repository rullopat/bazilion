import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { makeHome, runCli } from './helpers.ts'

function startOccupant(): Promise<{ port: number; close: () => Promise<void> }> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('not bazilion')
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((err) => (err ? closeReject(err) : closeResolve()))
          }),
      })
    })
  })
}

describe('dashboard command', () => {
  it('renders help', async () => {
    const h = makeHome()
    try {
      const r = await runCli(['dashboard', '--help'], h.home)
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toContain('Start the bazilion daemon and bundled web UI')
      expect(r.stdout).toContain('--no-open')
      expect(r.stdout).toContain('--daemon-port')
    } finally {
      h.cleanup()
    }
  })

  it('reports a non-bazilion daemon on the requested daemon port', async () => {
    const occupant = await startOccupant()
    const h = makeHome()
    try {
      const r = await runCli(
        ['dashboard', '--no-open', '--daemon-port', String(occupant.port)],
        h.home,
      )
      const output = `${r.stdout}\n${r.stderr}`
      expect(r.exitCode).not.toBe(0)
      expect(output).toContain(String(occupant.port))
      expect(output).toContain('--daemon-port')
    } finally {
      h.cleanup()
      await occupant.close()
    }
  })
})
