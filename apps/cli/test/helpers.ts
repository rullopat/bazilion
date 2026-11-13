import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cliEntry = join(import.meta.dirname, '..', 'src', 'index.ts')

export interface CliResult {
  stdout: string
  stderr: string
  exitCode: number
}

// The CLI runs from its .ts sources through Node's own type stripping (much faster to start
// than `tsx`); the sources use erasable TypeScript only.
export function runCli(
  args: string[],
  home: string,
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<CliResult> {
  // The CLI saves delivered files into its working directory, so each run gets a
  // scratch one instead of the repository checkout.
  const cwd = mkdtempSync(join(tmpdir(), 'bazilion-cli-cwd-'))
  const removeCwd = () => rmSync(cwd, { recursive: true, force: true })
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [cliEntry, ...args], {
      cwd,
      env: { ...process.env, BAZILION_HOME: home, ...extraEnv },
    })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    proc.stdout.on('data', (c: Buffer) => stdoutChunks.push(c))
    proc.stderr.on('data', (c: Buffer) => stderrChunks.push(c))
    proc.on('error', (error) => {
      removeCwd()
      reject(error)
    })
    proc.on('close', (code) => {
      removeCwd()
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: code ?? 0,
      })
    })
  })
}

export interface TestHome {
  home: string
  cleanup: () => void
}

export function makeHome(): TestHome {
  const home = mkdtempSync(join(tmpdir(), 'bazilion-cli-test-'))
  return {
    home,
    cleanup() {
      rmSync(home, { recursive: true, force: true })
    },
  }
}

export function extractAgentId(stdout: string): string {
  const m = stdout.match(/spawned agent ([\w-]+)/)
  if (!m?.[1]) throw new Error(`could not extract agent id from: ${stdout}`)
  return m[1]
}
