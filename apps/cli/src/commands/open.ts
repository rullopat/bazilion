import { existsSync } from 'node:fs'
import { defineCommand } from 'citty'
import { appLayout, installedPorts, startService } from '../mac-app.ts'
import { requestedHome } from '../paths.ts'
import { openBrowser, signInUrl } from '../sign-in.ts'
import { responds, waitFor } from './dashboard.ts'

/** A first start after an install or a restart reads a cold disk: give it time. */
const START_MS = 120_000

async function healthy(daemonUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${daemonUrl}/api/health`)
    return response.ok
  } catch {
    return false
  }
}

export const openCommand = defineCommand({
  meta: {
    name: 'open',
    description:
      'Open the dashboard in your browser, signed in; on macOS, start the Bazilion app first when it is not running',
  },
  args: {
    port: { type: 'string', description: 'Web UI port (default 4322, or the app’s)' },
    'daemon-port': { type: 'string', description: 'Daemon port (default 4321, or the app’s)' },
    print: {
      type: 'boolean',
      description: 'Print the sign-in link instead of opening it (it works once, for 2 minutes)',
    },
  },
  async run({ args }) {
    const layout = process.platform === 'darwin' ? appLayout(requestedHome()) : null
    const app = layout && existsSync(layout.plist) ? layout : null
    const ports = (app && installedPorts(app)) ?? { web: '4322', daemon: '4321' }
    const webUrl = `http://127.0.0.1:${args.port ?? ports.web}`
    const daemonUrl = `http://127.0.0.1:${args['daemon-port'] ?? ports.daemon}`

    if (!((await healthy(daemonUrl)) && (await responds(webUrl)))) {
      if (!app) {
        throw new Error(
          `Bazilion is not running at ${webUrl}. Start it with \`bazilion dashboard\`${
            process.platform === 'darwin'
              ? ', or install the Bazilion app: `bazilion app install`'
              : ''
          }.`,
        )
      }
      await startService(app)
      try {
        await waitFor(`${daemonUrl}/api/health`, 'the Bazilion daemon', START_MS)
        await waitFor(webUrl, 'the Bazilion web UI', START_MS)
      } catch {
        throw new Error(
          `Bazilion did not start within ${START_MS / 60_000} minutes. What it said is in ${app.log}`,
        )
      }
    }

    const url = await signInUrl(webUrl, daemonUrl)
    if (args.print) {
      console.log(url)
      return
    }
    openBrowser(url)
    console.log(`opened ${webUrl}${url === webUrl ? '' : ', signed in'}`)
  },
})
