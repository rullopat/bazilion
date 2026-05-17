import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { defineCommand } from 'citty'
import type { AuthFile } from '../auth-file.ts'
import { resolveCliPaths } from '../paths.ts'

function normalizeServer(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`invalid --server URL: ${raw}`)
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error(`--server must be http(s), got ${url.protocol}`)
  }
  // Strip trailing slash so `${serverUrl}${path}` never produces `//`.
  return `${url.origin}${url.pathname.replace(/\/$/, '')}`
}

async function verifyToken(server: string, token: string): Promise<void> {
  const res = await fetch(`${server}/api/health`, {
    headers: { authorization: `Bearer ${token}`, origin: server },
  })
  if (res.status === 401) throw new Error('server rejected token (401)')
  if (!res.ok) throw new Error(`server returned ${res.status} from /api/health`)
}

export const loginCommand = defineCommand({
  meta: {
    name: 'login',
    description: 'Save a remote bazilion server + token pair to auth.json',
  },
  args: {
    server: { type: 'string', description: 'Remote server URL (http[s]://...)' },
    token: { type: 'string', description: 'Token issued by `bazilion token create`' },
    skipVerify: { type: 'boolean', description: "Don't probe /api/health before saving" },
    clear: { type: 'boolean', description: 'Remove the stored remote instead of setting one' },
  },
  async run({ args }) {
    const paths = resolveCliPaths()
    if (!existsSync(paths.authFile)) {
      throw new Error(
        `${paths.authFile} not found. Start the daemon with "bazilion serve" first — login stores the remote there.`,
      )
    }
    const auth = JSON.parse(readFileSync(paths.authFile, 'utf8')) as AuthFile

    if (args.clear) {
      if (!auth.remote) {
        console.log('no remote stored — nothing to clear')
        return
      }
      delete auth.remote
      writeFileSync(paths.authFile, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 })
      console.log('cleared stored remote; CLI will fall back to the local daemon')
      return
    }

    if (!args.server || !args.token) {
      throw new Error(
        '--server and --token are required (or pass --clear to remove the stored remote)',
      )
    }
    const server = normalizeServer(args.server)
    if (!args.skipVerify) {
      await verifyToken(server, args.token)
    }
    auth.remote = { server, token: args.token }
    writeFileSync(paths.authFile, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 })
    console.log(`saved remote: ${server}`)
    console.log('CLI will now target this server unless BAZILION_SERVER is set in the env.')
  },
})
