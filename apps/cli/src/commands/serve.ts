import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { defineCommand } from 'citty'

// A published build has dist/daemon.js beside dist/cli.js; a source checkout runs the .ts entry.
const bundledDaemonEntry = join(import.meta.dirname, 'daemon.js')
export const daemonEntry = existsSync(bundledDaemonEntry)
  ? bundledDaemonEntry
  : join(import.meta.dirname, '..', '..', '..', 'daemon', 'src', 'index.ts')

/** Arguments for `process.execPath`: a source `.ts` entry loads through tsx. */
export function nodeArgs(entry: string): string[] {
  return entry.endsWith('.ts') ? ['--import', import.meta.resolve('tsx/esm'), entry] : [entry]
}

export const serveCommand = defineCommand({
  meta: {
    name: 'serve',
    description: 'Start the bazilion daemon (HTTP API)',
  },
  args: {
    port: { type: 'string', description: 'Port (default 4321)' },
    host: {
      type: 'string',
      description: 'Host (default 127.0.0.1). Put a TLS proxy in front before binding 0.0.0.0',
    },
  },
  async run({ args }) {
    if (!existsSync(daemonEntry)) throw new Error(`bazilion daemon not found at ${daemonEntry}`)
    const env: NodeJS.ProcessEnv = { ...process.env }
    if (args.port) env.PORT = args.port
    if (args.host) env.HOST = args.host
    console.log("web UI: run 'bazilion dashboard' (it reuses this daemon)")

    // The daemon prints its own startup log and handles SIGINT/SIGTERM; Ctrl+C reaches it
    // through the foreground process group, so this process only forwards SIGTERM and waits.
    const proc = spawn(process.execPath, nodeArgs(daemonEntry), { env, stdio: 'inherit' })
    let signalled = false
    process.on('SIGINT', () => {
      signalled = true
    })
    process.on('SIGTERM', () => {
      signalled = true
      proc.kill('SIGTERM')
    })
    await new Promise<void>((resolve, reject) => {
      proc.on('error', reject)
      proc.on('close', (code) => {
        // A signalled stop exits 0, so a `pnpm tsx … serve` wrapper reports no failure.
        if (!signalled && code) process.exitCode = code
        resolve()
      })
    })
  },
})
