import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, constants, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { BashOperations } from '@earendil-works/pi-coding-agent'

const CONTAINER_WORKDIR = '/workspace'
const MAX_TIMEOUT_MS = 2_147_483_647
const MAX_STDERR_CHARS = 16 * 1024
const CLEANUP_TIMEOUT_MS = 650
const CLEANUP_RETRY_DELAY_MS = 100
const CLEANUP_ATTEMPTS = 3
const DOCKER_CONTEXT_TIMEOUT_MS = 2_000
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]+$/
const DOCKER_CLIENT_ENV_KEYS = [
  'PATH',
  'HOME',
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_CONFIG',
  'DOCKER_CERT_PATH',
  'DOCKER_TLS_VERIFY',
  'DOCKER_API_VERSION',
  'XDG_CONFIG_HOME',
  'XDG_RUNTIME_DIR',
] as const
const DOCKER_CLIENT_CONTROL_ENV = new Set<string>(DOCKER_CLIENT_ENV_KEYS)
const SANDBOX_CONTROL_ENV = new Set(['BASH_ENV'])
const CONTAINER_LITERAL_ENV_KEYS = new Set([
  'PATH',
  'HOME',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'SHELL',
  'TMPDIR',
  'TZ',
])

export interface DockerBashOptions {
  image: string
  env: NodeJS.ProcessEnv
  dockerPath?: string
  /** Host environment used to resolve the active Docker context. Defaults to process.env. */
  hostEnv?: Readonly<NodeJS.ProcessEnv>
  /** Optional, narrowly scoped host directories exposed read-only. */
  readOnlyMounts?: readonly DockerReadOnlyMount[]
}

export interface DockerReadOnlyMount {
  source: string
  target: string
  /** Canonical host root the resolved source must remain within. */
  sourceRoot?: string
}

export interface DockerRunSpecInput extends DockerBashOptions {
  command: string
  mountSource: string
  containerName: string
  uid: number
  gid: number
  /** Immutable local image id resolved after policy inspection. */
  resolvedImage?: string
}

export interface DockerRunSpec {
  executable: string
  args: string[]
  containerName: string
  image: string
  mountSource: string
  /** Minimal environment for the Docker CLI; never the worker's merged env wholesale. */
  processEnv: NodeJS.ProcessEnv
  /** Docker env-file contents passed through an inherited anonymous descriptor. */
  envFileContent?: string
}

/** Build the complete, argument-array Docker invocation without touching the filesystem. */
export function buildDockerRunSpec(input: DockerRunSpecInput): DockerRunSpec {
  const executable = input.dockerPath ?? 'docker'
  validateDockerPath(executable)
  validateImage(input.image)
  if (input.resolvedImage !== undefined) validateImage(input.resolvedImage)
  validateContainerName(input.containerName)
  validateMountArgument(input.mountSource)
  const readOnlyMounts = input.readOnlyMounts ?? []
  validateReadOnlyMounts(readOnlyMounts, input.mountSource)
  validateHostIdentity(input.uid, input.gid)

  if (input.command.includes('\0')) {
    throw new Error('Docker sandbox command cannot contain a NUL byte')
  }

  const args = [
    'run',
    '--rm',
    '--pull',
    'never',
    '--name',
    input.containerName,
    '--network',
    'none',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,nosuid,nodev,size=64m,mode=1777',
    '--user',
    `${input.uid}:${input.gid}`,
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges=true',
    '--pids-limit',
    '256',
    '--entrypoint',
    '/bin/bash',
    '--workdir',
    CONTAINER_WORKDIR,
    // A bind mount is read/write unless `readonly` is present. No other mount is added.
    '--mount',
    `type=bind,source=${input.mountSource},target=${CONTAINER_WORKDIR},bind-recursive=disabled`,
  ]

  for (const mount of readOnlyMounts) {
    args.push(
      '--mount',
      `type=bind,source=${mount.source},target=${mount.target},readonly,bind-recursive=disabled`,
    )
  }

  const processEnv = buildDockerClientEnv(input.hostEnv ?? process.env)
  const envFileLines: string[] = []
  const containerEnvNames: string[] = []
  for (const [name, value] of sortedEnvironment(input.env)) {
    containerEnvNames.push(name)
    if (CONTAINER_LITERAL_ENV_KEYS.has(name)) {
      // These are shell mechanics, not operator-approved secret values. They
      // may differ from the host values needed by the Docker client itself.
      args.push('--env', `${name}=${value}`)
    } else {
      // Keep operator-approved values out of process argv and out of the
      // Docker client's own environment. The CLI reads these lines from its
      // stdin before asking the daemon to create the container.
      envFileLines.push(`${name}=${value}`)
    }
  }
  if (envFileLines.length > 0) args.push('--env-file', '/dev/fd/3')
  // Prevent an image-provided BASH_ENV from executing before the clean-env
  // wrapper. The final command environment below omits it entirely.
  args.push('--env', 'BASH_ENV=')

  const cleanAssignments = containerEnvNames.map((name) => `${name}="$${name}"`).join(' ')
  const cleanEnvironmentCommand =
    `exec /usr/bin/env -i${cleanAssignments ? ` ${cleanAssignments}` : ''} ` +
    '/bin/bash --noprofile --norc -c "$1"'
  args.push(
    input.resolvedImage ?? input.image,
    '--noprofile',
    '--norc',
    '-c',
    cleanEnvironmentCommand,
    'bazilion-sandbox',
    input.command,
  )

  return {
    executable,
    args,
    containerName: input.containerName,
    image: input.image,
    mountSource: input.mountSource,
    processEnv,
    ...(envFileLines.length > 0 ? { envFileContent: `${envFileLines.join('\n')}\n` } : {}),
  }
}

/**
 * Execute each bash command in a fresh, exact-name Docker container.
 *
 * The `env` supplied to `exec` by pi is intentionally ignored. The only values
 * passed into the container are the environment captured in `options.env`.
 */
export function createDockerBashOperations(options: DockerBashOptions): BashOperations {
  const image = options.image
  const env = { ...options.env }
  const dockerPath = options.dockerPath ?? 'docker'
  const configuredReadOnlyMounts = options.readOnlyMounts ?? []
  const hostEnv = { ...(options.hostEnv ?? process.env) }

  validateDockerPath(dockerPath)
  validateImage(image)

  return {
    async exec(command, cwd, { onData, signal, timeout }) {
      const timeoutMs = resolveTimeoutMs(timeout)
      if (signal?.aborted) throw new Error('aborted')

      const mountSource = await resolveMountSource(cwd)
      const readOnlyMounts = await Promise.all(
        configuredReadOnlyMounts.map(async (mount) => {
          const source = await resolveMountSource(mount.source)
          if (mount.sourceRoot && !isWithin(mount.sourceRoot, source)) {
            throw new Error(
              `Docker sandbox read-only mount escaped its configured root: ${mount.source}`,
            )
          }
          return { source, target: mount.target }
        }),
      )
      if (signal?.aborted) throw new Error('aborted')

      const { uid, gid } = hostIdentity()
      const dockerClientEnv = await resolveLocalDockerClientEnv(dockerPath, hostEnv)
      const resolvedImage = await inspectSandboxImage(dockerPath, image, dockerClientEnv)
      if (signal?.aborted) throw new Error('aborted')
      const containerName = `bazilion-bash-${process.pid}-${randomUUID().replaceAll('-', '')}`
      const spec = buildDockerRunSpec({
        image,
        env,
        dockerPath,
        command,
        mountSource,
        containerName,
        uid,
        gid,
        resolvedImage,
        readOnlyMounts,
        hostEnv: dockerClientEnv,
      })

      return executeDockerRun(spec, { onData, signal, timeout, timeoutMs })
    },
  }
}

interface DockerExecutionOptions {
  onData: (data: Buffer) => void
  signal?: AbortSignal
  timeout?: number
  timeoutMs?: number
}

function executeDockerRun(
  spec: DockerRunSpec,
  options: DockerExecutionOptions,
): Promise<{ exitCode: number | null }> {
  let envFileFd: number | undefined
  try {
    if (spec.envFileContent !== undefined) {
      envFileFd = openAnonymousEnvFile(spec.envFileContent)
    }
  } catch (error) {
    return Promise.reject(
      new Error(
        `Docker sandbox could not prepare its environment: ${error instanceof Error ? error.message : String(error)}`,
      ),
    )
  }

  return new Promise((resolve, reject) => {
    const child = spawn(spec.executable, spec.args, {
      stdio: ['ignore', 'pipe', 'pipe', envFileFd ?? 'ignore'],
      windowsHide: true,
      env: spec.processEnv,
    })
    if (envFileFd !== undefined) closeSync(envFileFd)

    let settled = false
    let termination: 'aborted' | 'timeout' | undefined
    let timeoutHandle: NodeJS.Timeout | undefined
    let stderr = ''

    const requestTermination = (reason: 'aborted' | 'timeout') => {
      termination ??= reason
      child.kill('SIGKILL')
    }

    const onAbort = () => requestTermination('aborted')

    const finish = async (exitCode: number | null, spawnError?: Error) => {
      if (settled) return
      settled = true

      if (timeoutHandle) clearTimeout(timeoutHandle)
      options.signal?.removeEventListener('abort', onAbort)

      if (!termination && options.signal?.aborted) termination = 'aborted'

      if (termination) {
        await removeContainer(spec.executable, spec.containerName, spec.processEnv)
        reject(
          termination === 'aborted'
            ? new Error('aborted')
            : new Error(`timeout:${options.timeout}`),
        )
        return
      }

      if (spawnError) {
        reject(formatSpawnError(spec.executable, spawnError))
        return
      }

      if (exitCode === 125) {
        await removeContainer(spec.executable, spec.containerName, spec.processEnv)
        reject(formatDockerRunError(spec, stderr))
        return
      }

      if (exitCode === null) {
        await removeContainer(spec.executable, spec.containerName, spec.processEnv)
        reject(new Error(`Docker sandbox CLI for container "${spec.containerName}" was killed`))
        return
      }

      resolve({ exitCode })
    }

    child.stdout?.on('data', options.onData)
    child.stderr?.on('data', (data: Buffer) => {
      stderr = `${stderr}${data.toString('utf8')}`.slice(-MAX_STDERR_CHARS)
      options.onData(data)
    })
    child.once('error', (error) => void finish(null, error))
    child.once('close', (exitCode) => void finish(exitCode))

    if (options.timeoutMs !== undefined) {
      timeoutHandle = setTimeout(() => requestTermination('timeout'), options.timeoutMs)
    }

    if (options.signal) {
      options.signal.addEventListener('abort', onAbort, { once: true })
      if (options.signal.aborted) onAbort()
    }
  })
}

function openAnonymousEnvFile(content: string): number {
  const dir = mkdtempSync(join(tmpdir(), 'bazilion-docker-env-'))
  const path = join(dir, 'environment')
  let fd: number | undefined
  try {
    writeFileSync(path, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    // The descriptor remains valid after unlink. Docker inherits it as fd 3,
    // while no pathname or secret-bearing file survives the spawn boundary.
    rmSync(dir, { recursive: true, force: true })
    return fd
  } catch (error) {
    if (fd !== undefined) closeSync(fd)
    rmSync(dir, { recursive: true, force: true })
    throw error
  }
}

function resolveTimeoutMs(timeout: number | undefined): number | undefined {
  if (timeout === undefined) return undefined
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error('Invalid timeout: must be a finite number of seconds')
  }

  const timeoutMs = timeout * 1_000
  if (timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`Invalid timeout: maximum is ${MAX_TIMEOUT_MS / 1_000} seconds`)
  }
  return timeoutMs
}

async function resolveMountSource(cwd: string): Promise<string> {
  try {
    await access(cwd, constants.F_OK)
    const info = await stat(cwd)
    if (!info.isDirectory()) {
      throw new Error(`Docker sandbox mount is not a directory: ${cwd}`)
    }
    return await realpath(cwd)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Docker sandbox mount is not')) {
      throw error
    }

    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      throw new Error(`Docker sandbox mount does not exist: ${cwd}`)
    }
    throw new Error(
      `Docker sandbox cannot access mount "${cwd}": ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function hostIdentity(): { uid: number; gid: number } {
  if (typeof process.getuid !== 'function' || typeof process.getgid !== 'function') {
    throw new Error('Docker sandbox requires a host platform with numeric uid/gid support')
  }
  return { uid: process.getuid(), gid: process.getgid() }
}

function sortedEnvironment(env: NodeJS.ProcessEnv): Array<[string, string]> {
  const entries: Array<[string, string]> = []
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue
    if (!ENV_NAME.test(name)) {
      throw new Error(
        `Docker sandbox environment variable name is invalid: ${JSON.stringify(name)}`,
      )
    }
    if (DOCKER_CLIENT_CONTROL_ENV.has(name) && !CONTAINER_LITERAL_ENV_KEYS.has(name)) {
      throw new Error(`Docker sandbox cannot pass Docker client control variable: ${name}`)
    }
    if (SANDBOX_CONTROL_ENV.has(name)) {
      throw new Error(`Docker sandbox cannot pass shell startup control variable: ${name}`)
    }
    if (value.includes('\0')) {
      throw new Error(`Docker sandbox environment variable ${name} contains a NUL byte`)
    }
    if (value.includes('\n') || value.includes('\r')) {
      throw new Error(`Docker sandbox environment variable ${name} cannot contain a line break`)
    }
    entries.push([name, value])
  }
  return entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}

async function resolveLocalDockerClientEnv(
  dockerPath: string,
  hostEnv: Readonly<NodeJS.ProcessEnv>,
): Promise<NodeJS.ProcessEnv> {
  const discoveryEnv = buildDockerClientEnv(hostEnv)
  const endpoint = await inspectDockerEndpoint(dockerPath, discoveryEnv)
  const prefix = 'unix://'
  if (!endpoint.startsWith(prefix) || !isAbsolute(endpoint.slice(prefix.length))) {
    throw new Error(
      `Docker sandbox requires a local Unix-socket context; active endpoint is ${JSON.stringify(endpoint)}`,
    )
  }

  // Pin all run/cleanup calls to the inspected endpoint. This prevents an
  // ambient remote context or a later context-file change from redirecting
  // bind mounts to another machine.
  const pinned: NodeJS.ProcessEnv = { DOCKER_HOST: endpoint }
  if (hostEnv.PATH !== undefined) pinned.PATH = hostEnv.PATH
  if (hostEnv.HOME !== undefined) pinned.HOME = hostEnv.HOME
  return pinned
}

async function inspectDockerEndpoint(
  dockerPath: string,
  processEnv: NodeJS.ProcessEnv,
): Promise<string> {
  const raw = await runDockerInspection(
    dockerPath,
    ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'],
    processEnv,
    'the active context',
  )
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'string' || parsed.length === 0) throw new Error('empty endpoint')
    return parsed
  } catch {
    throw new Error(
      `Docker sandbox could not resolve the active Docker endpoint: ${raw || 'empty context response'}`,
    )
  }
}

async function inspectSandboxImage(
  dockerPath: string,
  image: string,
  processEnv: NodeJS.ProcessEnv,
): Promise<string> {
  let raw: string
  try {
    raw = await runDockerInspection(
      dockerPath,
      ['image', 'inspect', '--format', '{{json .Id}}\t{{json (index .Config "Volumes")}}', image],
      processEnv,
      `local image ${JSON.stringify(image)}`,
    )
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    if (/no such image|unable to find image|manifest unknown/i.test(detail)) {
      throw new Error(`Docker sandbox image "${image}" is unavailable: ${detail}`)
    }
    throw error
  }

  const separator = raw.indexOf('\t')
  if (separator < 0) {
    throw new Error(`Docker sandbox received an invalid inspection result for image "${image}"`)
  }
  let id: unknown
  let volumes: unknown
  try {
    id = JSON.parse(raw.slice(0, separator))
    volumes = JSON.parse(raw.slice(separator + 1))
  } catch {
    throw new Error(`Docker sandbox received an invalid inspection result for image "${image}"`)
  }
  if (typeof id !== 'string' || !id.startsWith('sha256:')) {
    throw new Error(`Docker sandbox received an invalid image id for "${image}"`)
  }
  if (volumes !== null && typeof volumes === 'object' && Object.keys(volumes).length > 0) {
    throw new Error(
      `Docker sandbox image "${image}" declares writable volumes (${Object.keys(volumes).sort().join(', ')}); use an image without VOLUME declarations`,
    )
  }
  if (volumes !== null && (typeof volumes !== 'object' || Array.isArray(volumes))) {
    throw new Error(`Docker sandbox received invalid volume metadata for image "${image}"`)
  }
  return id
}

function runDockerInspection(
  dockerPath: string,
  args: string[],
  processEnv: NodeJS.ProcessEnv,
  subject: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(dockerPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: processEnv,
    })
    let settled = false
    let stdout = ''
    let stderr = ''
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutHandle)
      if (error) {
        reject(error)
        return
      }
      resolve(stdout.trim())
    }
    const timeoutHandle = setTimeout(() => {
      child.kill('SIGKILL')
      finish(
        new Error(
          `Docker sandbox could not inspect ${subject} within ${DOCKER_CONTEXT_TIMEOUT_MS}ms`,
        ),
      )
    }, DOCKER_CONTEXT_TIMEOUT_MS)

    child.stdout.on('data', (data: Buffer) => {
      stdout = `${stdout}${data.toString('utf8')}`.slice(-4_096)
    })
    child.stderr.on('data', (data: Buffer) => {
      stderr = `${stderr}${data.toString('utf8')}`.slice(-4_096)
    })
    child.once('error', (error) => finish(formatSpawnError(dockerPath, error)))
    child.once('close', (code) => {
      if (code === 0) finish()
      else
        finish(
          new Error(
            `Docker sandbox could not inspect ${subject}: ${stderr.trim() || `Docker exited with status ${code}`}`,
          ),
        )
    })
  })
}

function buildDockerClientEnv(hostEnv: Readonly<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of DOCKER_CLIENT_ENV_KEYS) {
    const value = hostEnv[key]
    if (value !== undefined) env[key] = value
  }
  return env
}

function validateDockerPath(dockerPath: string): void {
  if (!dockerPath.trim()) throw new Error('Docker sandbox executable path is required')
  if (dockerPath.includes('\0'))
    throw new Error('Docker sandbox executable path contains a NUL byte')
}

function validateImage(image: string): void {
  if (!image.trim()) throw new Error('Docker sandbox image is required')
  if (image.startsWith('-')) {
    throw new Error(`Docker sandbox image cannot start with "-": ${JSON.stringify(image)}`)
  }
  if (image.includes('\0')) throw new Error('Docker sandbox image contains a NUL byte')
}

function validateContainerName(containerName: string): void {
  if (!CONTAINER_NAME.test(containerName)) {
    throw new Error(`Docker sandbox container name is invalid: ${JSON.stringify(containerName)}`)
  }
}

function validateMountArgument(mountSource: string): void {
  if (!mountSource) throw new Error('Docker sandbox mount path is required')
  if (mountSource.includes('\0') || mountSource.includes(',')) {
    throw new Error(
      `Docker sandbox mount path cannot be represented safely: ${JSON.stringify(mountSource)}`,
    )
  }
}

function validateReadOnlyMounts(
  mounts: readonly DockerReadOnlyMount[],
  workspaceSource: string,
): void {
  const targets = new Set<string>([CONTAINER_WORKDIR, '/tmp'])
  for (const mount of mounts) {
    validateMountArgument(mount.source)
    if (
      mount.sourceRoot !== undefined &&
      (!isAbsolute(mount.sourceRoot) ||
        mount.sourceRoot.includes('\0') ||
        mount.sourceRoot.includes(','))
    ) {
      throw new Error(
        `Docker sandbox read-only mount root is invalid: ${JSON.stringify(mount.sourceRoot)}`,
      )
    }
    if (
      !mount.target.startsWith('/') ||
      mount.target.includes('\0') ||
      mount.target.includes(',') ||
      mount.target.split('/').includes('..')
    ) {
      throw new Error(
        `Docker sandbox read-only mount target is invalid: ${JSON.stringify(mount.target)}`,
      )
    }
    if (mount.source === workspaceSource) {
      throw new Error('Docker sandbox cannot mount the writable workspace again as an input')
    }
    if (targets.has(mount.target)) {
      throw new Error(`Docker sandbox mount target is duplicated or reserved: ${mount.target}`)
    }
    targets.add(mount.target)
  }
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

function validateHostIdentity(uid: number, gid: number): void {
  if (!Number.isSafeInteger(uid) || uid < 0 || !Number.isSafeInteger(gid) || gid < 0) {
    throw new Error(`Docker sandbox received an invalid host uid/gid: ${uid}:${gid}`)
  }
}

function formatSpawnError(dockerPath: string, error: Error): Error {
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'ENOENT') {
    return new Error(`Docker sandbox unavailable: executable "${dockerPath}" was not found`)
  }
  if (code === 'EACCES') {
    return new Error(`Docker sandbox unavailable: executable "${dockerPath}" is not executable`)
  }
  return new Error(`Docker sandbox could not start "${dockerPath}": ${error.message}`)
}

function formatDockerRunError(spec: DockerRunSpec, stderr: string): Error {
  const detail = stderr.trim() || 'Docker exited with status 125 without an error message'
  if (/no such image|unable to find image|manifest unknown|pull access denied/i.test(detail)) {
    return new Error(`Docker sandbox image "${spec.image}" is unavailable: ${detail}`)
  }
  if (
    /mounts denied|invalid mount config|bind source path does not exist|mount.*failed/i.test(detail)
  ) {
    return new Error(`Docker sandbox mount failed for "${spec.mountSource}": ${detail}`)
  }
  if (/cannot connect to the docker daemon|is the docker daemon running/i.test(detail)) {
    return new Error(`Docker sandbox unavailable: ${detail}`)
  }
  return new Error(`Docker sandbox failed to start container "${spec.containerName}": ${detail}`)
}

async function removeContainer(
  dockerPath: string,
  containerName: string,
  processEnv: NodeJS.ProcessEnv,
): Promise<void> {
  const args = ['container', 'rm', '--force', containerName]
  let last: CleanupResult | undefined
  for (let attempt = 0; attempt < CLEANUP_ATTEMPTS; attempt += 1) {
    last = await runCleanupCommand(dockerPath, args, processEnv)
    if (last.ok) return
    if (attempt < CLEANUP_ATTEMPTS - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, CLEANUP_RETRY_DELAY_MS))
    }
  }

  if (last && !last.missing) {
    console.warn(
      `Docker sandbox could not confirm cleanup of container "${containerName}": ${last.error || 'cleanup command failed'}`,
    )
  }
}

interface CleanupResult {
  ok: boolean
  missing: boolean
  error: string
}

function runCleanupCommand(
  dockerPath: string,
  args: string[],
  processEnv: NodeJS.ProcessEnv,
): Promise<CleanupResult> {
  return new Promise((resolve) => {
    let done = false
    let stderr = ''
    const child = spawn(dockerPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
      env: processEnv,
    })
    const finish = (ok: boolean, error = '') => {
      if (done) return
      done = true
      clearTimeout(timeoutHandle)
      const detail = error || stderr.trim()
      resolve({
        ok,
        missing: /no such container/i.test(detail),
        error: detail,
      })
    }
    const timeoutHandle = setTimeout(() => {
      child.kill('SIGKILL')
      finish(false, `cleanup timed out after ${CLEANUP_TIMEOUT_MS}ms`)
    }, CLEANUP_TIMEOUT_MS)

    child.stderr.on('data', (data: Buffer) => {
      stderr = `${stderr}${data.toString('utf8')}`.slice(-2_048)
    })
    child.once('error', (error) => finish(false, error.message))
    child.once('close', (code) => finish(code === 0))
  })
}
