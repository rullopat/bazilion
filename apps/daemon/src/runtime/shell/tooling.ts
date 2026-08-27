import { existsSync, lstatSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import {
  createBashToolDefinition,
  createLocalBashOperations,
  defineTool,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { type BashApprovalHost, createApprovalGatedBashTool } from './approval.ts'
import {
  createDockerBashOperations,
  createPreparedDockerBashOperations,
  type DockerReadOnlyMount,
  type ProtectedDockerRuntime,
} from './docker.ts'
import {
  buildScrubbedShellEnv,
  resolveShellSecurityConfig,
  type ShellSecurityConfig,
} from './security.ts'

const HOST_CODING_TOOL_NAMES = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] as const
const HOST_FILE_TOOL_NAMES = ['read', 'edit', 'write', 'grep', 'find', 'ls'] as const

const CONTAINER_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
export const SANDBOX_INPUTS_DIR = '/inputs'
export const SANDBOX_MEMORY_DIR = '/workspace/memory'

export interface SessionShellToolOptions {
  /** Agent-private uploaded documents, exposed read-only at /inputs when present. */
  inputsDir?: string
  /** Attached skill directories, each mapped to a stable read-only container path. */
  skillMounts?: readonly DockerReadOnlyMount[]
  /** Turn-scoped dangerous-command approval bridge. Omit to deny risky commands. */
  approvalHost?: BashApprovalHost
}

export interface SessionShellTools {
  config: ShellSecurityConfig
  /** Pi built-ins that remain host-backed and may be enabled for this session. */
  hostToolNames: readonly string[]
  /** Same-name replacement for Pi's built-in bash when isolation or approval is active. */
  customBash?: ToolDefinition
}

/** Build the mandatory Docker-only coding surface for a protected turn. */
export function createProtectedSessionShellTools(
  cwd: string,
  runtime: ProtectedDockerRuntime,
  approvalHost: BashApprovalHost,
): SessionShellTools {
  const base = createBashToolDefinition(cwd, {
    operations: createPreparedDockerBashOperations(runtime),
  })
  const dockerBash = defineTool({
    ...base,
    label: 'bash (protected Docker sandbox)',
    description: `${base.description} Runs in an ephemeral, network-disabled Docker container with the Team workspace mounted read/write plus only the preflighted read-only memory, skill, and attachment mounts. Host files, host tools, and host credentials are unavailable.`,
  })
  return {
    config: {
      sandboxMode: 'docker',
      approvalMode: 'dangerous',
      sandboxImage: runtime.image,
      envAllowlist: [],
    },
    hostToolNames: [],
    customBash: createApprovalGatedBashTool(dockerBash, approvalHost),
  }
}

/**
 * Build the only environment visible to a sandboxed command.
 *
 * Operator-allowlisted values are copied first. Container-specific basics are
 * then pinned so host paths (especially HOME) cannot leak into the sandbox or
 * point programs back at an unavailable host directory.
 */
export function buildSandboxContainerEnv(
  env: NodeJS.ProcessEnv,
  allowlist: readonly string[],
): NodeJS.ProcessEnv {
  return {
    ...buildScrubbedShellEnv(env, allowlist),
    PATH: CONTAINER_PATH,
    HOME: '/tmp',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    SHELL: '/bin/bash',
    TMPDIR: '/tmp',
  }
}

/**
 * Resolve the session's host-vs-container coding-tool surface.
 *
 * Docker mode deliberately enables no host-backed Pi coding tools. The
 * returned custom bash is still allowlisted by name by its caller, while
 * read/edit/write/grep/find/ls stay inactive so absolute host paths cannot
 * bypass the container boundary.
 */
export function createSessionShellTools(
  cwd: string,
  env: NodeJS.ProcessEnv,
  options: SessionShellToolOptions = {},
): SessionShellTools {
  const config = resolveShellSecurityConfig(env)
  if (config.sandboxMode === 'off' && config.approvalMode === 'off') {
    return { config, hostToolNames: HOST_CODING_TOOL_NAMES }
  }

  if (config.sandboxMode === 'off') {
    const base = createBashToolDefinition(cwd, {
      operations: createLocalBashOperations(),
    })
    const customBash = createApprovalGatedBashTool(base, options.approvalHost)
    return { config, hostToolNames: HOST_FILE_TOOL_NAMES, customBash }
  }

  const operations = createDockerBashOperations({
    image: config.sandboxImage,
    env: buildSandboxContainerEnv(env, config.envAllowlist),
    readOnlyMounts: [
      ...(existsSync(join(cwd, 'memory'))
        ? [safeReadOnlyMount(join(cwd, 'memory'), SANDBOX_MEMORY_DIR, cwd)]
        : []),
      ...(options.inputsDir
        ? [safeReadOnlyMount(options.inputsDir, SANDBOX_INPUTS_DIR, dirname(options.inputsDir))]
        : []),
      ...(options.skillMounts ?? []).map((mount) =>
        safeReadOnlyMount(mount.source, mount.target, dirname(mount.source)),
      ),
    ],
  })
  const base = createBashToolDefinition(cwd, { operations })
  const dockerBash = defineTool({
    ...base,
    label: 'bash (Docker sandbox)',
    description: `${base.description} Runs in an ephemeral, network-disabled Docker container with the team workspace mounted read/write plus only bounded read-only memory, skill, and attachment mounts. Other host files and host credentials are unavailable.`,
  })
  const customBash =
    config.approvalMode === 'dangerous'
      ? createApprovalGatedBashTool(dockerBash, options.approvalHost)
      : dockerBash

  return { config, hostToolNames: [], customBash }
}

function safeReadOnlyMount(
  source: string,
  target: string,
  expectedRoot: string,
): DockerReadOnlyMount {
  const info = lstatSync(source)
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`Docker sandbox read-only mount must be a real directory: ${source}`)
  }

  const sourceRoot = realpathSync(expectedRoot)
  const canonicalSource = realpathSync(source)
  const rel = relative(sourceRoot, canonicalSource)
  const contained = rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  if (!contained) {
    throw new Error(`Docker sandbox read-only mount escaped its configured root: ${source}`)
  }

  return { source: canonicalSource, target, sourceRoot }
}
