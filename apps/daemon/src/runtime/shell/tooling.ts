import { existsSync, lstatSync, mkdirSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import {
  createBashToolDefinition,
  createLocalBashOperations,
  defineTool,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { type TSchema, Type } from 'typebox'
import type { JobHost, JobOutputResult } from '../worker/ipc-protocol.ts'
import {
  type BashApprovalHost,
  createApprovalGatedBashTool,
  requireBashApproval,
} from './approval.ts'
import { ContainerPaths } from './container-paths.ts'
import {
  CONTAINER_WORKSPACE,
  containerWorkdir,
  createDockerBashOperations,
  type DockerMount,
  type DockerSandbox,
} from './docker.ts'
import { dockerApplyPatchTool, dockerFileTools, hostApplyPatchTool } from './file-tools.ts'
import { resolveShellSecurityConfig, type ShellSecurityConfig } from './security.ts'

const HOST_CODING_TOOL_NAMES = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] as const
const HOST_FILE_TOOL_NAMES = ['read', 'edit', 'write', 'grep', 'find', 'ls'] as const

export const SANDBOX_INPUTS_DIR = '/inputs'
const SANDBOX_MEMORY_DIR = `${CONTAINER_WORKSPACE}/memory`

/** One turn's Docker settings, chosen by the daemon from the Team defaults. */
export interface DockerTurn {
  image: string
  /** Team-relative working directory of every command ('.' is the workspace root). */
  cwd: string
  /** Name prefix of the turn's containers (`turnContainerPrefix`). */
  containerPrefix: string
}

export interface SessionShellToolOptions {
  /** This turn's Docker settings; sessions without them use the installation image. */
  docker?: DockerTurn
  /** Container name prefix when there are no turn settings (`homeContainerPrefix`). */
  containerPrefix?: string
  /** Agent-private uploaded files, mounted read-only at /inputs when present. */
  inputsDir?: string
  /** Attached skill directories, each mounted read-only at its /skills path. */
  skillMounts?: readonly DockerMount[]
  /** Turn-scoped dangerous-command approval bridge. Omit to deny risky commands. */
  approvalHost?: BashApprovalHost
  /** The daemon's background jobs: with it, bash takes `background: true`. */
  jobHost?: JobHost
  /** The Agent's secrets, by name, for Docker commands (host commands inherit them). */
  secretEnv?: Readonly<Record<string, string>>
}

export interface SessionShellTools {
  config: ShellSecurityConfig
  /** Pi built-ins that remain host-backed and may be enabled for this session. */
  hostToolNames: readonly string[]
  /** Same-name replacement for Pi's built-in bash when Docker, approval or jobs are active. */
  customBash?: ToolDefinition
  /**
   * File tools of Bazilion's own: `apply_patch` always, and in Docker mode read, write, edit,
   * grep, find and ls on container paths (Pi's own take host paths, which would bypass it).
   */
  fileTools: ToolDefinition[]
}

/**
 * The container one command (or background job) of a Docker turn runs in: the Team workspace at
 * /workspace, its memory/ read-only, uploads at /inputs and skills under /skills. Evaluated when
 * it is used, so the mounts are checked then.
 */
export function buildDockerSandbox(
  cwd: string,
  turn: DockerTurn,
  mounts: {
    inputsDir?: string
    skillMounts?: readonly DockerMount[]
    secretEnv?: Readonly<Record<string, string>>
  } = {},
): DockerSandbox {
  const workspace = realpathSync(cwd)
  if (
    turn.cwd !== '.' &&
    !statSync(join(workspace, turn.cwd), { throwIfNoEntry: false })?.isDirectory()
  )
    throw new Error(`Working directory does not exist: ${containerWorkdir(turn.cwd)}`)
  // The memory store is always mounted read-only, so a command cannot create it either.
  mkdirSync(join(workspace, 'memory'), { recursive: true })
  return {
    image: turn.image,
    workspace,
    workdir: containerWorkdir(turn.cwd),
    readOnlyMounts: [
      readOnlyMount(join(workspace, 'memory'), SANDBOX_MEMORY_DIR, workspace),
      ...(mounts.inputsDir && existsSync(mounts.inputsDir)
        ? [readOnlyMount(mounts.inputsDir, SANDBOX_INPUTS_DIR, dirname(mounts.inputsDir))]
        : []),
      ...(mounts.skillMounts ?? []).map((mount) =>
        readOnlyMount(mount.source, mount.target, dirname(mount.source)),
      ),
    ],
    containerPrefix: turn.containerPrefix,
    ...(mounts.secretEnv && Object.keys(mounts.secretEnv).length > 0
      ? { env: mounts.secretEnv }
      : {}),
  }
}

const BACKGROUND_HELP =
  ' For a command that keeps running (a dev server, a watcher, a long build), pass background: true: it starts as a background job, the call answers at once with its id and what it printed so far, and job_output, job_input, job_stop and job_list act on it. A job runs until it ends or is stopped; one that ends after this turn wakes you with its end.'

/** bash with `background: true`, which starts a job through the daemon instead of waiting. */
function withBackground(
  bash: ToolDefinition,
  jobs: JobHost | undefined,
  approve:
    | ((command: string, toolCallId: string, signal?: AbortSignal) => Promise<void>)
    | undefined,
): ToolDefinition {
  if (!jobs) return bash
  const base = bash.parameters as unknown as { properties: Record<string, TSchema> }
  const tool: ToolDefinition = {
    ...bash,
    description: `${bash.description}${BACKGROUND_HELP}`,
    parameters: Type.Object({
      ...base.properties,
      background: Type.Optional(
        Type.Boolean({ description: 'Start it as a background job and answer at once.' }),
      ),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { background, ...command } = params as { background?: boolean; command: string }
      if (!background) return bash.execute(toolCallId, command as never, signal, onUpdate, ctx)
      // A background command is approved like any other before it starts.
      if (approve) await approve(command.command, toolCallId, signal)
      const started = await jobs.start({ command: command.command })
      return {
        content: [{ type: 'text' as const, text: describeStartedJob(started) }],
        details: {},
      }
    },
  }
  return tool
}

function describeStartedJob(started: JobOutputResult): string {
  const { job } = started
  const state =
    job.status === 'running'
      ? 'is running'
      : job.status === 'exited'
        ? `already ended, with exit code ${job.exitCode}`
        : 'was stopped'
  const output = started.output.trim()
  return [
    `Started background job ${job.id}; it ${state}.`,
    output ? `Output so far${started.cut ? ' (the end of it)' : ''}:\n${output}` : 'No output yet.',
    'Read more with job_output, stop it with job_stop.',
  ].join('\n')
}

/**
 * Resolve the session's coding tools. Docker mode enables no host-backed Pi tool: read, edit,
 * write, grep, find and ls take absolute host paths, which would bypass the container.
 */
export function createSessionShellTools(
  cwd: string,
  env: NodeJS.ProcessEnv,
  options: SessionShellToolOptions = {},
): SessionShellTools {
  const config = resolveShellSecurityConfig(env)
  const gated = config.approvalMode !== 'off'
  if (config.sandboxMode === 'off') {
    const fileTools = [hostApplyPatchTool(cwd)]
    if (!gated && !options.jobHost) {
      return { config, hostToolNames: HOST_CODING_TOOL_NAMES, fileTools }
    }
    const base = createBashToolDefinition(cwd, { operations: createLocalBashOperations() })
    const bash = gated ? createApprovalGatedBashTool(base, options.approvalHost, cwd) : base
    return {
      config,
      hostToolNames: HOST_FILE_TOOL_NAMES,
      customBash: withBackground(
        bash as unknown as ToolDefinition,
        options.jobHost,
        gated
          ? (command, id, signal) =>
              requireBashApproval(command, id, signal, options.approvalHost, cwd)
          : undefined,
      ),
      fileTools,
    }
  }

  const containerPrefix = options.docker?.containerPrefix ?? options.containerPrefix
  if (!containerPrefix) throw new Error('Docker sandbox requires a container name prefix')
  const turn: DockerTurn = options.docker ?? {
    image: config.sandboxImage,
    cwd: '.',
    containerPrefix,
  }
  const sandbox = () => buildDockerSandbox(cwd, turn, options)
  const base = createBashToolDefinition(cwd, {
    operations: createDockerBashOperations(sandbox),
    exposeSessionEnvironment: false,
  })
  const bash = defineTool({
    ...base,
    label: 'bash (Docker sandbox)',
    description: `${base.description} Each command runs in a fresh network-disabled Docker container. The Team workspace is ${CONTAINER_WORKSPACE} (memory/ is read-only), uploaded files are under ${SANDBOX_INPUTS_DIR} and attached skills under /skills, all read-only; the rest of the filesystem is read-only except /tmp, which does not persist. Host files and credentials are unavailable.`,
  })
  // The file tools reach what commands see: the same mounts, checked at each use.
  const containerPaths = () => {
    const current = sandbox()
    return new ContainerPaths([
      { target: CONTAINER_WORKSPACE, source: current.workspace, writable: true },
      ...current.readOnlyMounts.map((mount) => ({ ...mount, writable: false })),
    ])
  }
  const workdir = containerWorkdir(turn.cwd)
  const gatedBash = gated
    ? createApprovalGatedBashTool(bash, options.approvalHost, CONTAINER_WORKSPACE)
    : bash
  return {
    config: { ...config, sandboxImage: turn.image },
    hostToolNames: [],
    fileTools: [
      ...dockerFileTools(workdir, containerPaths),
      dockerApplyPatchTool(workdir, containerPaths),
    ],
    customBash: withBackground(
      gatedBash as unknown as ToolDefinition,
      options.jobHost,
      gated
        ? (command, id, signal) =>
            requireBashApproval(command, id, signal, options.approvalHost, CONTAINER_WORKSPACE)
        : undefined,
    ),
  }
}

/**
 * A read-only mount of a real directory (never a symlink) inside `root`: a symlink left by an
 * earlier host-mode command must not expose its target to the container.
 */
function readOnlyMount(source: string, target: string, root: string): DockerMount {
  if (!lstatSync(source).isDirectory())
    throw new Error(`Docker sandbox read-only mount must be a real directory: ${source}`)
  const real = realpathSync(source)
  const rel = relative(realpathSync(root), real)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error(`Docker sandbox read-only mount escaped its root: ${source}`)
  return { source: real, target }
}
