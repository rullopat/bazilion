import { existsSync, lstatSync, mkdirSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import {
  createBashToolDefinition,
  createLocalBashOperations,
  defineTool,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { type BashApprovalHost, createApprovalGatedBashTool } from './approval.ts'
import {
  CONTAINER_WORKSPACE,
  containerWorkdir,
  createDockerBashOperations,
  type DockerMount,
  type DockerSandbox,
} from './docker.ts'
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
}

export interface SessionShellTools {
  config: ShellSecurityConfig
  /** Pi built-ins that remain host-backed and may be enabled for this session. */
  hostToolNames: readonly string[]
  /** Same-name replacement for Pi's built-in bash when Docker or approval is active. */
  customBash?: ToolDefinition
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
  if (config.sandboxMode === 'off') {
    if (config.approvalMode === 'off') return { config, hostToolNames: HOST_CODING_TOOL_NAMES }
    const base = createBashToolDefinition(cwd, { operations: createLocalBashOperations() })
    return {
      config,
      hostToolNames: HOST_FILE_TOOL_NAMES,
      customBash: createApprovalGatedBashTool(base, options.approvalHost, cwd),
    }
  }

  const containerPrefix = options.docker?.containerPrefix ?? options.containerPrefix
  if (!containerPrefix) throw new Error('Docker sandbox requires a container name prefix')
  const turn: DockerTurn = options.docker ?? {
    image: config.sandboxImage,
    cwd: '.',
    containerPrefix,
  }
  const sandbox = (): DockerSandbox => {
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
        ...(options.inputsDir && existsSync(options.inputsDir)
          ? [readOnlyMount(options.inputsDir, SANDBOX_INPUTS_DIR, dirname(options.inputsDir))]
          : []),
        ...(options.skillMounts ?? []).map((mount) =>
          readOnlyMount(mount.source, mount.target, dirname(mount.source)),
        ),
      ],
      containerPrefix: turn.containerPrefix,
    }
  }
  const base = createBashToolDefinition(cwd, {
    operations: createDockerBashOperations(sandbox),
    exposeSessionEnvironment: false,
  })
  const bash = defineTool({
    ...base,
    label: 'bash (Docker sandbox)',
    description: `${base.description} Each command runs in a fresh network-disabled Docker container. The Team workspace is ${CONTAINER_WORKSPACE} (memory/ is read-only), uploaded files are under ${SANDBOX_INPUTS_DIR} and attached skills under /skills, all read-only; the rest of the filesystem is read-only except /tmp, which does not persist. Host files and credentials are unavailable.`,
  })
  return {
    config: { ...config, sandboxImage: turn.image },
    hostToolNames: [],
    customBash:
      config.approvalMode === 'dangerous'
        ? createApprovalGatedBashTool(bash, options.approvalHost, CONTAINER_WORKSPACE)
        : bash,
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
