// A machine without Chrome, Brave, Edge or Chromium gets Playwright's Chromium: the daemon
// downloads it once, at startup or at the first browser action, whichever comes first. The npm
// install does not do it, because package managers skip dependency install scripts.

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { type BrowserExecutable, findBrowserExecutable, NO_BROWSER_FOUND } from './executable.ts'

const DOWNLOAD_TIMEOUT_MS = 15 * 60_000
/** What Playwright's installer needs: where to write, how to reach the network. */
const INSTALLER_ENV =
  /^(PATH|HOME|TMPDIR|XDG_CACHE_HOME|NODE_EXTRA_CA_CERTS|PLAYWRIGHT_.*|(HTTPS?|NO|ALL)_PROXY)$/i

let download: Promise<void> | null = null
let lastError: string | null = null

/** PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD, Playwright's own switch, turns the download off. */
function downloadAllowed(): boolean {
  const skip = process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD?.trim().toLowerCase()
  return !skip || skip === '0' || skip === 'false'
}

/** Run `playwright install chromium` (full Chromium, no headless shell) from the bundled Playwright. */
function runInstaller(): Promise<void> {
  return new Promise((resolve, reject) => {
    const cli = join(
      dirname(createRequire(import.meta.url).resolve('playwright/package.json')),
      'cli.js',
    )
    const child = spawn(
      process.execPath,
      [cli, 'install', '--no-shell', '--no-progress', 'chromium'],
      {
        env: Object.fromEntries(
          Object.entries(process.env).filter(([name]) => INSTALLER_ENV.test(name)),
        ),
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: DOWNLOAD_TIMEOUT_MS,
      },
    )
    let output = ''
    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString('utf8')).slice(-2_000)
    }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(output.trim() || `the installer ended with ${signal ?? code}`))
    })
  })
}

/** Download Chromium; calls made while a download runs share it. */
function downloadChromium(): Promise<void> {
  if (!download) {
    console.log('browser: no browser is installed, downloading Chromium (once)…')
    const run = runInstaller().then(
      () => {
        lastError = null
        console.log('browser: Chromium downloaded')
      },
      (error: unknown) => {
        lastError = error instanceof Error ? error.message : String(error)
        console.error(`browser: downloading Chromium failed: ${lastError}`)
        throw error
      },
    )
    download = run
    const clear = () => {
      if (download === run) download = null
    }
    run.then(clear, clear)
  }
  return download
}

/** The browser to launch; when none is installed, Chromium is downloaded first. */
export async function ensureBrowserExecutable(configuredPath?: string): Promise<BrowserExecutable> {
  try {
    return findBrowserExecutable(configuredPath)
  } catch (error) {
    if (configuredPath || !downloadAllowed()) throw error
  }
  try {
    await downloadChromium()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`${NO_BROWSER_FOUND} Downloading Chromium failed: ${detail}`)
  }
  return findBrowserExecutable()
}

/** At daemon start: get Chromium in the background when the machine has no browser. */
export function prepareBrowser(configuredPath?: string): void {
  // A failure is logged by the download and shown in the browser status.
  ensureBrowserExecutable(configuredPath).catch(() => {})
}

/** For the status of a machine without a browser: the download in progress or its last failure. */
export function browserDownloadNote(): string | null {
  if (download) return 'No browser is installed yet: Chromium is being downloaded.'
  return lastError ? `${NO_BROWSER_FOUND} Downloading Chromium failed: ${lastError}` : null
}
