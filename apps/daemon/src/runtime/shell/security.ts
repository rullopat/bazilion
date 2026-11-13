import { posix } from 'node:path'
import type { CommandRisk, CommandRiskCode } from '@bazilion/api-types'

export type { CommandRisk, CommandRiskCode } from '@bazilion/api-types'

export type BashSandboxMode = 'off' | 'docker'

export type BashApprovalPolicy = 'off' | 'dangerous'

export interface ShellSecurityConfig {
  sandboxMode: BashSandboxMode
  approvalMode: BashApprovalPolicy
  sandboxImage: string
}

export const DEFAULT_BASH_SANDBOX_IMAGE = 'debian:bookworm-slim'

const DOCKER_IMAGE_RE = /^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/

const SENSITIVE_HOME_PATH_RE =
  /(?:~(?:[A-Za-z0-9_-]+)?|\$(?:HOME|\{HOME\})|\/(?:home|Users)\/[^\s'"`;|&/]+|\/root)\/\.(?:ssh|aws|gnupg)(?:\/[^\s'"`;|&]*)?/gi
const SENSITIVE_FILE_RE =
  /(?:\bauth\.json\b|\bbazilion\.db\b|(?:^|[\s/'"=])\.env(?:\.[A-Za-z0-9_-]+)?(?=$|[\s/'"`;|&])|\/etc\/(?:shadow|sudoers)(?:\.d\/[^\s'"`;|&]+)?)/gim
const SENSITIVE_ENV_RE =
  /\b(?:OPENAI_CODEX_OAUTH|AWS_ACCESS_KEY_ID|AWS_PROFILE|GOOGLE_APPLICATION_CREDENTIALS|BAZILION_TOKEN|(?:[A-Z][A-Z0-9_]*_)?(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|OAUTH_TOKEN|CLIENT_SECRET|SECRET_ACCESS_KEY|PRIVATE_KEY))\b/g

const REMOTE_PIPE_RE =
  /(?:^|[;&|(\n])\s*(?:command\s+)?(?:curl|wget)\b[^;&\n]*(?:\|\s*(?:(?:sudo|env)\s+)*(?:[^\s;&|()]+\/)?(?:sh|bash|dash|zsh|fish|node|python(?:3)?|perl|ruby)\b)/gim

const COMMAND_BOUNDARY_RE = /[;&|)\n]/

function addRisk(
  command: string,
  risks: CommandRisk[],
  seen: Set<string>,
  input: { code: CommandRiskCode; message: string; start: number; end: number },
): void {
  const start = Math.max(0, input.start)
  const end = Math.min(command.length, Math.max(start, input.end))
  const key = `${input.code}:${start}:${end}`
  if (seen.has(key)) return
  seen.add(key)
  risks.push({ code: input.code, message: input.message, span: { start, end } })
}

function addRegexRisks(
  command: string,
  risks: CommandRisk[],
  seen: Set<string>,
  pattern: RegExp,
  code: CommandRiskCode,
  message: string,
): void {
  pattern.lastIndex = 0
  for (const match of command.matchAll(pattern)) {
    if (match.index === undefined) continue
    let start = match.index
    let matchedText = match[0]

    // Some patterns consume a shell delimiter to express a command boundary.
    // Keep the reported span focused on the risky command itself.
    const leading = matchedText.match(/^[;&|(\n\s]+/)
    if (leading) {
      start += leading[0].length
      matchedText = matchedText.slice(leading[0].length)
    }

    addRisk(command, risks, seen, {
      code,
      message,
      start,
      end: start + matchedText.length,
    })
  }
}

function shellTokens(fragment: string): string[] {
  return Array.from(fragment.matchAll(/"(?:\\.|[^"\\])*"|'[^']*'|[^\s]+/g), (match) =>
    match[0].replace(/^(?:"|')|(?:"|')$/g, ''),
  )
}

function isBroadFilesystemTarget(rawTarget: string, workspace?: string): boolean {
  let target = rawTarget.replace(/[;,]+$/, '')
  // An absolute target can point outside the Team regardless of its top-level
  // directory (/mnt, /srv, /data, custom mounts, ...), unless it lies inside the
  // workspace: there it is judged like the relative path it names. Relative
  // project-local targets such as ./dist stay below the approval threshold.
  if (target.startsWith('/')) {
    const normalized = posix.normalize(target).replace(/(.)\/+$/, '$1')
    if (!workspace || !normalized.startsWith(`${workspace}/`)) return true
    target = `./${normalized.slice(workspace.length + 1)}`
  }
  return /^(?:\.|\.\/\*+|\*+|~(?:\/.*)?|\$(?:HOME|\{HOME\})(?:\/.*)?|\.\.(?:\/.*)?)$/.test(target)
}

function classifyBroadFilesystemOperations(
  command: string,
  risks: CommandRisk[],
  seen: Set<string>,
  workspace: string | undefined,
): void {
  const broad = (target: string) => isBroadFilesystemTarget(target, workspace)
  const commandRe = /(?:^|[;&|(\n])\s*(?:command\s+)?(rm|find|chmod|chown)\b[^;&|)\n]*/gim
  for (const match of command.matchAll(commandRe)) {
    if (match.index === undefined || !match[1]) continue
    const nameOffset = match[0].toLowerCase().indexOf(match[1].toLowerCase())
    const start = match.index + nameOffset
    const text = command.slice(start, match.index + match[0].length).trimEnd()
    const tokens = shellTokens(text)
    const name = tokens[0]?.toLowerCase()
    const args = tokens.slice(1)
    let risky = false

    if (name === 'rm') {
      const recursive = args.some(
        (arg) => arg === '--recursive' || (/^-[^-]+$/.test(arg) && /[rR]/.test(arg)),
      )
      risky = recursive && args.some((arg) => !arg.startsWith('-') && broad(arg))
    } else if (name === 'find') {
      const target = args.find((arg) => !arg.startsWith('-'))
      risky = args.includes('-delete') && target !== undefined && broad(target)
    } else if (name === 'chmod' || name === 'chown') {
      const recursive = args.some(
        (arg) => arg === '--recursive' || (/^-[^-]+$/.test(arg) && /R/.test(arg)),
      )
      risky = recursive && args.some((arg) => !arg.startsWith('-') && broad(arg))
    }

    if (!risky) continue
    addRisk(command, risks, seen, {
      code: 'broad-destructive-operation',
      message: 'Recursively changes or deletes a broad filesystem target.',
      start,
      end: start + text.length,
    })
  }
}

function isLocalHostname(rawHostname: string): boolean {
  const hostname = rawHostname
    .trim()
    .replace(/^.*@/, '')
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase()
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '::1' ||
    hostname === '0.0.0.0' ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  )
}

function hasExternalHttpDestination(segment: string): boolean {
  const urls = Array.from(segment.matchAll(/https?:\/\/[^\s'"`]+/gi), (match) => match[0])
  if (urls.length === 0) return true
  return urls.some((rawUrl) => {
    try {
      return !isLocalHostname(new URL(rawUrl).hostname)
    } catch {
      return true
    }
  })
}

function remoteTransferHosts(segment: string): string[] {
  const hosts: string[] = []
  const uriRe = /(?:sftp|ssh|rsync):\/\/(?:[^@\s/]+@)?(\[[^\]]+\]|[^\s/:]+)(?::\d+)?/gi
  for (const match of segment.matchAll(uriRe)) {
    if (match[1]) hosts.push(match[1])
  }

  const scpRe = /(?:^|\s)(?:[^@\s:]+@)?(\[[^\]]+\]|[A-Za-z0-9._-]+):[^\s]+/g
  for (const match of segment.matchAll(scpRe)) {
    if (match[1]) hosts.push(match[1])
  }
  return hosts
}

function invocationSegment(
  command: string,
  match: RegExpMatchArray,
  commandName: string,
): {
  start: number
  text: string
} | null {
  if (match.index === undefined) return null
  const nameOffset = match[0].toLowerCase().indexOf(commandName.toLowerCase())
  if (nameOffset < 0) return null
  const start = match.index + nameOffset
  const boundaryOffset = command.slice(start).search(COMMAND_BOUNDARY_RE)
  const end = boundaryOffset < 0 ? command.length : start + boundaryOffset
  return { start, text: command.slice(start, end).trimEnd() }
}

function classifyOutboundExfiltration(
  command: string,
  risks: CommandRisk[],
  seen: Set<string>,
): void {
  const invocationRe = /(?:^|[;&|(\n])\s*(?:command\s+)?(curl|wget|scp|rsync|nc|netcat|sftp)\b/gim
  for (const match of command.matchAll(invocationRe)) {
    const name = match[1]?.toLowerCase()
    if (!name) continue
    const segment = invocationSegment(command, match, name)
    if (!segment) continue
    let risky = false

    if (name === 'curl') {
      const uploads =
        /(?:^|\s)(?:-X\s*POST\b|-[dFT](?:\s|[^\s]))/.test(segment.text) ||
        /(?:^|\s)(?:--request(?:=|\s+)POST\b|--data(?:-[a-z-]+)?(?:=|\s)|--form(?:-string)?(?:=|\s)|--upload-file(?:=|\s))/i.test(
          segment.text,
        )
      risky = uploads && hasExternalHttpDestination(segment.text)
    } else if (name === 'wget') {
      const uploads =
        /(?:^|\s)(?:--method(?:=|\s+)POST\b|--post-data(?:=|\s)|--post-file(?:=|\s)|--body-data(?:=|\s)|--body-file(?:=|\s))/i.test(
          segment.text,
        )
      risky = uploads && hasExternalHttpDestination(segment.text)
    } else if (name === 'scp' || name === 'rsync') {
      const hosts = remoteTransferHosts(segment.text)
      risky =
        hosts.some((host) => !isLocalHostname(host)) ||
        (hosts.length === 0 && /\$/.test(segment.text))
    } else if (name === 'sftp') {
      const hosts = remoteTransferHosts(segment.text)
      if (hosts.length > 0) {
        risky = hosts.some((host) => !isLocalHostname(host))
      } else {
        const destination = shellTokens(segment.text).at(-1)
        risky = destination !== undefined && destination !== name && !isLocalHostname(destination)
      }
    } else {
      const tokens = shellTokens(segment.text)
      const host = tokens.find(
        (token, index) =>
          index > 0 &&
          !token.startsWith('-') &&
          !/^\d+$/.test(token) &&
          !['tcp', 'udp'].includes(token.toLowerCase()),
      )
      risky = host !== undefined && !isLocalHostname(host)
    }

    if (!risky) continue
    addRisk(command, risks, seen, {
      code: 'outbound-exfiltration',
      message: 'Uploads data or opens a transfer connection to a non-local destination.',
      start: segment.start,
      end: segment.start + segment.text.length,
    })
  }
}

function classifyPrivilegeAndCredentialAccess(
  command: string,
  risks: CommandRisk[],
  seen: Set<string>,
): void {
  const patterns = [
    /(?:^|[;&|(\n])\s*(?:sudo|su|doas|pkexec)\b[^;&|)\n]*/gim,
    /(?:^|[;&|(\n])\s*security\s+(?:find-(?:generic|internet)-password|dump-keychain)\b[^;&|)\n]*/gim,
    /(?:^|[;&|(\n])\s*gcloud\s+auth\b[^;&|)\n]*/gim,
    /(?:^|[;&|(\n])\s*aws\s+(?:configure|sso\s+login)\b[^;&|)\n]*/gim,
    /(?:^|[;&|(\n])\s*git\s+credential(?:-[A-Za-z0-9_-]+|\s+(?:fill|approve|reject))?\b[^;&|)\n]*/gim,
    /(?:^|[;&|(\n])\s*(?:docker|npm|gh)\s+(?:login|auth\s+token)\b[^;&|)\n]*/gim,
    /(?:^|[;&|(\n])\s*(?:pass\s+(?:show|ls)|secret-tool\s+lookup|ssh-add\s+-[Ll])\b[^;&|)\n]*/gim,
    /(?:^|[;&|(\n])\s*(?:env|printenv|set|export\s+-p)\s*(?=$|[;&|)\n])/gim,
  ]

  for (const pattern of patterns) {
    addRegexRisks(
      command,
      risks,
      seen,
      pattern,
      'privilege-or-credential-access',
      'Requests elevated privileges or accesses a credential store.',
    )
  }
}

/**
 * Conservatively identify shell commands that should hit the dangerous-command
 * approval tripwire. This is a classifier, not a shell parser or sandbox.
 * `workspace` is the Team directory as the command sees it (`/workspace` in
 * Docker): absolute paths below it count as project-local.
 */
export function classifyBashCommand(command: string, workspace?: string): CommandRisk[] {
  const risks: CommandRisk[] = []
  const seen = new Set<string>()

  addRegexRisks(
    command,
    risks,
    seen,
    SENSITIVE_HOME_PATH_RE,
    'sensitive-path-read',
    'Accesses a path that commonly contains credentials.',
  )
  addRegexRisks(
    command,
    risks,
    seen,
    SENSITIVE_FILE_RE,
    'sensitive-path-read',
    'Accesses a sensitive environment, authentication, or database file.',
  )
  addRegexRisks(
    command,
    risks,
    seen,
    SENSITIVE_ENV_RE,
    'sensitive-path-read',
    'References an environment variable name commonly used for credentials.',
  )
  classifyBroadFilesystemOperations(command, risks, seen, workspace)
  addRegexRisks(
    command,
    risks,
    seen,
    REMOTE_PIPE_RE,
    'remote-pipe-execution',
    'Pipes downloaded content directly into an interpreter.',
  )
  classifyOutboundExfiltration(command, risks, seen)
  classifyPrivilegeAndCredentialAccess(command, risks, seen)

  return risks.sort((a, b) => a.span.start - b.span.start || a.code.localeCompare(b.code))
}

/** Resolve shell sandbox settings without silently accepting unsafe typos. */
export function resolveShellSecurityConfig(
  env: Readonly<NodeJS.ProcessEnv> = process.env,
): ShellSecurityConfig {
  const rawMode = env.BAZILION_BASH_SANDBOX?.trim() ?? ''
  if (rawMode !== '' && rawMode !== 'off' && rawMode !== 'docker') {
    throw new Error(`BAZILION_BASH_SANDBOX must be "off" or "docker", received: ${rawMode}`)
  }

  const rawApproval = env.BAZILION_BASH_APPROVAL?.trim() ?? ''
  if (rawApproval !== '' && rawApproval !== 'off' && rawApproval !== 'dangerous') {
    throw new Error(`BAZILION_BASH_APPROVAL must be "off" or "dangerous", received: ${rawApproval}`)
  }

  const rawImage = env.BAZILION_BASH_SANDBOX_IMAGE?.trim() ?? ''
  if (rawImage !== '' && !DOCKER_IMAGE_RE.test(rawImage)) {
    throw new Error(
      `BAZILION_BASH_SANDBOX_IMAGE is not a valid Docker image reference: ${rawImage}`,
    )
  }

  return {
    sandboxMode: rawMode === 'docker' ? 'docker' : 'off',
    approvalMode: rawApproval === 'dangerous' ? 'dangerous' : 'off',
    sandboxImage: rawImage || DEFAULT_BASH_SANDBOX_IMAGE,
  }
}

/** Bazilion's own credentials, by variable name: never handed to Agent tools. */
const INTERNAL_SECRET_NAME =
  /^(?:OPENAI_CODEX_OAUTH|TELEGRAM_BOT_TOKEN|BAZILION_TOKEN|MCP_TOKEN_.*)$/

/**
 * The environment for Agent tools (the turn worker, so its shell commands, and MCP stdio servers):
 * `env` without Bazilion's own credentials — the ChatGPT OAuth blob, MCP bearer tokens, the Telegram
 * bot token and the bootstrap token, under whatever name it appears. Provider API keys stay.
 */
export function toolEnvironment(env: NodeJS.ProcessEnv, bootstrapToken: string): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([name, value]) => !INTERNAL_SECRET_NAME.test(name) && value !== bootstrapToken,
    ),
  )
}
