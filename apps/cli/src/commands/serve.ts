import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { defineCommand } from 'citty'

// apps/cli/src/commands/serve.ts → apps/daemon/src/index.ts
const daemonEntry = join(import.meta.dirname, '..', '..', '..', 'daemon', 'src', 'index.ts')

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
    if (!existsSync(daemonEntry)) {
      throw new Error(
        `bazilion daemon not found at ${daemonEntry}. Are you running from a development checkout?`,
      )
    }

    const env: NodeJS.ProcessEnv = { ...process.env }
    if (args.port) env.PORT = args.port
    if (args.host) env.HOST = args.host

    const host = args.host ?? '127.0.0.1'
    const port = args.port ?? '4321'

    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
      console.error('')
      console.error(`⚠ binding to ${host} — the daemon is now reachable beyond loopback.`)
      console.error('  anyone on this network who has a valid token can reach every API.')
      console.error('  put a TLS proxy in front for untrusted networks.')
      console.error('')
    }

    console.log(`starting bazilion daemon at http://${host}:${port}`)
    console.log('(web UI runs separately: cd apps/web && pnpm dev)')

    // Spawn the daemon under tsx. Stdio inherited so the daemon's startup log
    // and any console.error go to the user's terminal directly. The daemon
    // installs its own SIGINT/SIGTERM handlers and shuts the HTTP server
    // gracefully — we just need to keep this process alive long enough for it.
    //
    // No vite anywhere in this tree → the daemon never flips the TTY into raw
    // mode, so the post-Ctrl+C arrow-key-echo bug is gone by construction.
    const proc = spawn('node', ['--import', 'tsx/esm', daemonEntry], {
      env,
      stdio: 'inherit',
    })

    let signalled = false
    const onSigterm = (): void => {
      signalled = true
      try {
        proc.kill('SIGTERM')
      } catch {}
    }
    // SIGINT from the kernel (Ctrl+C) goes to the foreground pgroup, so the
    // daemon already gets it directly — we just have to stay alive.
    process.on('SIGINT', () => {
      signalled = true
    })
    process.on('SIGTERM', onSigterm)

    await new Promise<void>((resolve, reject) => {
      proc.on('error', (err) => reject(err))
      proc.on('close', (code) => {
        // signalled exits get translated to 0 so the outer `pnpm tsx … serve`
        // wrapper doesn't print `ELIFECYCLE Command failed` after a clean Ctrl+C.
        if (signalled) {
          process.exitCode = 0
          resolve()
        } else if (code === 0 || code === null) {
          resolve()
        } else {
          process.exitCode = code
          resolve()
        }
      })
    })
  },
})
