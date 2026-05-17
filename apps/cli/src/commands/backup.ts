import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { defineCommand } from 'citty'
import { loadClientConfig } from '../client.ts'
import { resolveCliPaths } from '../paths.ts'

const createCmd = defineCommand({
  meta: { name: 'create', description: 'Download a tar.gz backup of ~/.bazilion from the server' },
  args: {
    output: {
      type: 'positional',
      required: false,
      description: 'Output file path (default: ./bazilion-backup-YYYY-MM-DD.tar.gz)',
    },
  },
  async run({ args }) {
    const cfg = loadClientConfig()
    const date = new Date().toISOString().slice(0, 10)
    const outAbs = resolve(args.output ?? `bazilion-backup-${date}.tar.gz`)

    console.log(`downloading backup → ${outAbs}`)
    const res = await fetch(`${cfg.serverUrl}/api/backup`, {
      headers: { authorization: `Bearer ${cfg.token}`, origin: cfg.serverUrl },
    })
    if (!res.ok || !res.body) {
      let err: string = res.statusText
      try {
        const body = (await res.json()) as { error?: string }
        err = body.error ?? err
      } catch {}
      throw new Error(`backup failed: ${err}`)
    }
    await pipeline(Readable.fromWeb(res.body), createWriteStream(outAbs))
    console.log('done')
  },
})

/**
 * Offline restore. Server must be stopped first — SQLite's DB files would get
 * corrupted if the running daemon has them open while tar overwrites them.
 * We check the default loopback port as a best-effort safety net.
 */
async function probeServerRunning(port: number): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 500)
    // /login is unauthenticated (see middleware.ts PUBLIC_PATHS) — any response
    // means something is listening on the port.
    const res = await fetch(`http://127.0.0.1:${port}/login`, { signal: ctrl.signal })
    clearTimeout(timer)
    return res.status >= 200 && res.status < 600
  } catch {
    return false
  }
}

const restoreCmd = defineCommand({
  meta: {
    name: 'restore',
    description: 'Extract a backup tar.gz into ~/.bazilion (offline; server must be stopped)',
  },
  args: {
    file: {
      type: 'positional',
      required: true,
      description: 'Path to tar.gz backup file',
    },
    home: { type: 'string', description: 'Override BAZILION_HOME' },
    force: {
      type: 'boolean',
      description: 'Overwrite existing non-empty home (destroys existing data)',
    },
  },
  async run({ args }) {
    const file = resolve(args.file)
    if (!existsSync(file)) throw new Error(`backup file not found: ${file}`)

    const paths = resolveCliPaths(args.home)
    const targetHome = paths.home

    // Only probe for a running server when restoring to the default home —
    // an explicit `--home` points somewhere the running daemon isn't using,
    // so there's no DB-corruption risk to warn about. `--force` bypasses
    // the probe either way.
    const defaultHome = !args.home && !process.env.BAZILION_HOME
    if (defaultHome && !args.force && (await probeServerRunning(4321))) {
      throw new Error(
        'bazilion server appears to be running on :4321 — stop it first (DB ' +
          'corruption risk), or pass --force to override.',
      )
    }

    if (existsSync(targetHome)) {
      const entries = readdirSync(targetHome)
      if (entries.length > 0) {
        if (!args.force) {
          throw new Error(
            `${targetHome} is not empty. Pass --force to overwrite (destroys existing data).`,
          )
        }
        rmSync(targetHome, { recursive: true, force: true })
      }
    }
    mkdirSync(targetHome, { recursive: true })

    console.log(`extracting ${file} → ${targetHome}`)
    await new Promise<void>((res, rej) => {
      const proc = spawn('tar', ['-xzf', file, '-C', targetHome], { stdio: 'inherit' })
      proc.on('error', rej)
      proc.on('exit', (code) => {
        if (code === 0) res()
        else rej(new Error(`tar exited with code ${code}`))
      })
    })

    console.log(`restored to ${targetHome}`)
    console.log('start the server with: bazilion serve  (migrations apply automatically)')
  },
})

export const backupCommand = defineCommand({
  meta: { name: 'backup', description: 'Create or restore a ~/.bazilion tar.gz backup' },
  subCommands: {
    create: createCmd,
    restore: restoreCmd,
  },
  // `bazilion backup` with no positional falls through to citty's subcommand
  // prompt ("No command specified"). The previous default (auto-download to
  // cwd) double-fired when a subcommand was used because citty runs parent's
  // `run` after the subcommand completes — explicit `create` / `restore` is
  // the supported form now.
})
