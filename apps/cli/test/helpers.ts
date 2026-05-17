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

// Test CLI spawns use Node 22.12+'s built-in `--experimental-strip-types`
// instead of `tsx`. Startup drops from ~1.5s (tsx's transform cost) to
// ~140ms (node loading .ts via native strip). Across a full suite with
// hundreds of CLI invocations that's ~60s saved wall-clock. The project
// already requires Node 22.12 (engines in root package.json), and no code
// uses enums/namespaces — the only TS forms strip-types can't handle.
//
// `--no-warnings` silences the "ExperimentalWarning: Type Stripping is an
// experimental feature" banner that would otherwise land on stderr and
// upset tests that assert clean stderr. On Node 25+ the flag is
// effectively stable but the warning still fires.
const STRIP_TYPES_ARGS = ['--experimental-strip-types', '--no-warnings']

export function runCli(
  args: string[],
  home: string,
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [...STRIP_TYPES_ARGS, cliEntry, ...args], {
      env: { ...process.env, BAZILION_HOME: home, ...extraEnv },
    })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    proc.stdout.on('data', (c: Buffer) => stdoutChunks.push(c))
    proc.stderr.on('data', (c: Buffer) => stderrChunks.push(c))
    proc.on('error', reject)
    proc.on('close', (code) => {
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
