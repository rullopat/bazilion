// Opening the web UI signed in: the CLI holds the home's token, asks the daemon for a one-time
// sign-in link and opens that, so nobody pastes a token into the browser.

import { spawn } from 'node:child_process'
import type { SignInLinkResponse } from '@bazilion/api-types'
import { readAuthFile } from './auth-file.ts'
import { resolveCliPaths } from './paths.ts'

export function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.env.BROWSER || 'xdg-open'
  spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref()
}

/**
 * The web UI's address with a one-time sign-in link for this home, or the plain address when
 * the daemon gives none (an older daemon already running, or a home without its auth.json).
 */
export async function signInUrl(webUrl: string, daemonUrl: string): Promise<string> {
  try {
    const { token } = readAuthFile(resolveCliPaths().authFile)
    const response = await fetch(`${daemonUrl}/api/auth/sign-in-link`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
    if (!response.ok) return webUrl
    const { path } = (await response.json()) as SignInLinkResponse
    return path.startsWith('/') ? `${webUrl}${path}` : webUrl
  } catch {
    return webUrl
  }
}
