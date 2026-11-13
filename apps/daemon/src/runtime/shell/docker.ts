// The Docker sandbox: every bash command runs in a fresh `docker run --rm` container with no
// network, a read-only root, a private /tmp, the Team workspace mounted read/write at /workspace and
// read-only mounts for Team memory, uploaded files and attached skills. Nothing from the host
// environment enters the container. Containers carry a per-turn name prefix, so the daemon can remove
// whatever a killed worker left running.

import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import type { BashOperations } from '@earendil-works/pi-coding-agent'

/** Where the Team workspace is mounted in every container. */
export const CONTAINER_WORKSPACE = '/workspace'

/** Bound for the short Docker calls (image inspect, listing, removal), not for commands. */
const DOCKER_CALL_TIMEOUT_MS = 5_000
const MAX_TIMER_MS = 2_147_483_647

export interface DockerMount {
  /** Host directory. */
  source: string
  /** Absolute path inside the container. */
  target: string
}

export interface DockerSandbox {
  image: string
  /** Host directory mounted read/write at /workspace. */
  workspace: string
  /** Working directory inside the container. */
  workdir: string
  readOnlyMounts: readonly DockerMount[]
  /** Every container is named `<containerPrefix><random>`. */
  containerPrefix: string
}

/** The container path of a Team-relative directory ('.' is the workspace root). */
export function containerWorkdir(cwd: string): string {
  return cwd === '.' ? CONTAINER_WORKSPACE : `${CONTAINER_WORKSPACE}/${cwd}`
}

/** The complete `docker run` argument list for one command. */
export function dockerRunArgs(sandbox: DockerSandbox, name: string, command: string): string[] {
  const user =
    process.getuid && process.getgid ? ['--user', `${process.getuid()}:${process.getgid()}`] : []
  return [
    'run',
    '--rm',
    '--name',
    name,
    '--pull',
    'never',
    '--network',
    'none',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,nosuid,nodev,size=64m,mode=1777',
    ...user,
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges=true',
    '--pids-limit',
    '256',
    '--env',
    'HOME=/tmp',
    '--env',
    'TMPDIR=/tmp',
    '--env',
    'LANG=C.UTF-8',
    '--workdir',
    sandbox.workdir,
    '--mount',
    bindMount(sandbox.workspace, CONTAINER_WORKSPACE, false),
    ...sandbox.readOnlyMounts.flatMap((mount) => [
      '--mount',
      bindMount(mount.source, mount.target, true),
    ]),
    '--entrypoint',
    '/bin/bash',
    sandbox.image,
    '-c',
    command,
  ]
}

function bindMount(source: string, target: string, readonly: boolean): string {
  // `--mount` takes comma-separated fields, so such a path cannot be passed as one field.
  if (/[,"\n\r]/.test(source))
    throw new Error(
      `Docker sandbox cannot mount a path containing a comma, quote or newline: ${source}`,
    )
  return `type=bind,source=${source},target=${target}${readonly ? ',readonly' : ''},bind-recursive=disabled`
}

/**
 * Pi bash operations that run each command in a fresh container. `sandbox` is evaluated for every
 * command, so mounts are checked when they are used. Pi's working directory and environment are
 * ignored: the container's come from the sandbox.
 */
export function createDockerBashOperations(sandbox: () => DockerSandbox): BashOperations {
  return {
    async exec(command, _cwd, { onData, signal, timeout }) {
      if (timeout !== undefined && !(Number.isFinite(timeout) && timeout > 0))
        throw new Error('Invalid timeout: must be a positive number of seconds')
      if (signal?.aborted) throw new Error('aborted')
      const current = sandbox()
      const name = `${current.containerPrefix}${randomUUID().replaceAll('-', '').slice(0, 12)}`
      const args = dockerRunArgs(current, name, command)
      return new Promise<{ exitCode: number | null }>((resolve, reject) => {
        const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
        let stopped: Error | undefined
        let settled = false
        const stop = (reason: Error) => {
          stopped ??= reason
          child.kill('SIGKILL')
        }
        const onAbort = () => stop(new Error('aborted'))
        const timer =
          timeout === undefined
            ? undefined
            : setTimeout(
                () => stop(new Error(`timeout:${timeout}`)),
                Math.min(timeout * 1000, MAX_TIMER_MS),
              )
        signal?.addEventListener('abort', onAbort, { once: true })
        const settle = async (error: Error | undefined, exitCode: number | null) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          if (stopped) {
            // Killing `docker run` does not stop its container.
            await removeContainers([name])
            reject(stopped)
          } else if (error) reject(dockerError(error))
          else resolve({ exitCode })
        }
        child.stdout.on('data', onData)
        child.stderr.on('data', onData)
        child.once('error', (error) => void settle(error, null))
        child.once('close', (code) => void settle(undefined, code))
      })
    },
  }
}

/** Whether `image` is available to the local Docker engine; the error is Docker's own. */
export async function checkDockerImage(
  image: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await docker(['image', 'inspect', '--format', '{{.Id}}', image])
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Name prefix shared by every container one Bazilion home creates. */
export function homeContainerPrefix(home: string): string {
  return `bazilion-${createHash('sha256').update(home).digest('hex').slice(0, 12)}-`
}

/** A fresh prefix for the containers of one turn of this home. */
export function turnContainerPrefix(home: string): string {
  return `${homeContainerPrefix(home)}${randomUUID().replaceAll('-', '').slice(0, 12)}-`
}

/**
 * Remove every container whose name starts with `prefix`: what a killed worker (at turn end) or a
 * stopped daemon (at startup) left behind. Never throws; without Docker there is nothing to remove.
 */
export async function removeDockerContainers(prefix: string): Promise<void> {
  try {
    const listed = await docker([
      'ps',
      '--all',
      '--filter',
      `name=${prefix}`,
      '--format',
      '{{.Names}}',
    ])
    await removeContainers(listed.split('\n').filter((name) => name.startsWith(prefix)))
  } catch {
    // Docker is not installed or not running.
  }
}

async function removeContainers(names: string[]): Promise<void> {
  if (names.length === 0) return
  await docker(['rm', '--force', ...names]).catch((error: unknown) => {
    if (!/no such container/i.test(String(error)))
      console.warn(`Docker sandbox could not remove ${names.join(', ')}: ${String(error)}`)
  })
}

/** Run one short `docker` call; resolves with its stdout, rejects with its stderr. */
function docker(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`docker ${args[0]} did not finish within ${DOCKER_CALL_TIMEOUT_MS / 1000}s`))
    }, DOCKER_CALL_TIMEOUT_MS)
    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString('utf8')
    })
    child.stderr.on('data', (data: Buffer) => {
      stderr = `${stderr}${data.toString('utf8')}`.slice(-4_096)
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(dockerError(error))
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(stderr.trim() || `docker ${args[0]} exited with status ${code}`))
    })
  })
}

function dockerError(error: Error): Error {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
    ? new Error('Docker is not installed: no `docker` executable on PATH')
    : error
}
