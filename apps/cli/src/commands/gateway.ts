import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { HealthReport } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'

const execFileAsync = promisify(execFile)

function exactHttpsOrigin(raw: string | undefined): URL {
  if (!raw) throw new Error('BAZILION_PUBLIC_ORIGIN is required')
  const url = new URL(raw)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.origin !== raw.replace(/\/$/, '')
  ) {
    throw new Error('BAZILION_PUBLIC_ORIGIN must be an exact HTTPS origin')
  }
  return url
}

function listenerIsLoopback(output: string, port: number): boolean {
  const suffix = `:${port}`
  const listeners = output
    .split('\n')
    .filter((line) => line.trim())
    .filter((line) => line.split(/\s+/).some((field) => field.endsWith(suffix)))
  return (
    listeners.length > 0 && listeners.every((line) => /(?:127\.0\.0\.1|\[?::1\]?):\d+/.test(line))
  )
}

function hasFunnel(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasFunnel)
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(
    ([key, nested]) =>
      (/funnel/i.test(key) && nested !== false && nested !== null) || hasFunnel(nested),
  )
}

const preflightCmd = defineCommand({
  meta: { name: 'preflight', description: 'Read-only private Tailscale gateway safety check' },
  async run() {
    const publicOrigin = exactHttpsOrigin(process.env.BAZILION_PUBLIC_ORIGIN)
    const daemonPort = Number(process.env.PORT ?? 4321)
    const webPort = Number(process.env.WEB_PORT ?? 4322)
    const { stdout: listeners } = await execFileAsync('ss', ['-ltnH'], { timeout: 5_000 })
    if (!listenerIsLoopback(listeners, daemonPort)) {
      throw new Error(`daemon port ${daemonPort} is not listening exclusively on loopback`)
    }
    if (!listenerIsLoopback(listeners, webPort)) {
      throw new Error(`web port ${webPort} is not listening exclusively on loopback`)
    }

    let serveStatus: unknown
    try {
      const { stdout } = await execFileAsync('tailscale', ['serve', 'status', '--json'], {
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      })
      serveStatus = JSON.parse(stdout) as unknown
    } catch {
      throw new Error('could not obtain unambiguous `tailscale serve status --json` evidence')
    }
    if (hasFunnel(serveStatus))
      throw new Error('Tailscale Funnel is enabled; private Serve is required')
    const serialized = JSON.stringify(serveStatus)
    if (
      !serialized.includes(`127.0.0.1:${webPort}`) &&
      !serialized.includes(`localhost:${webPort}`)
    ) {
      throw new Error(`Tailscale Serve does not clearly target the loopback web port ${webPort}`)
    }

    const health = await createClient().get<HealthReport>('/api/health/details')
    if (!health.protectedWorkBaselineReady) {
      throw new Error('BAZ-027 protected-turn baseline is not ready')
    }
    console.log('private gateway preflight passed')
    console.log(`public origin: ${publicOrigin.origin}`)
    console.log(`daemon: loopback:${daemonPort}`)
    console.log(`web: loopback:${webPort}`)
    console.log('Tailscale: private Serve target present; Funnel absent')
    console.log('hosted Agent turns: protected baseline ready')
  },
})

export const gatewayCommand = defineCommand({
  meta: { name: 'gateway', description: 'Inspect the private web gateway posture' },
  subCommands: { preflight: preflightCmd },
})
