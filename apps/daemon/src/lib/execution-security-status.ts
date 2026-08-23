import type {
  ExecutionSecurityReport,
  HealthReport,
  ProtectedDockerReadinessReason,
} from '@bazilion/api-types'

export interface ExecutionSecurityProjectionInput {
  configuredOperatorHttp: {
    shellSecurity: HealthReport['shellSecurity']
    dockerImage: string
    browserEnabled: boolean
    mcpEnabled: boolean
  }
  protectedUnattendedTurns: {
    docker: {
      ready: boolean
      image: string
      reason: ProtectedDockerReadinessReason | null
      /** Internal adapter fact; omitted from the public projection. Defaults true. */
      configurationValid?: boolean
    }
    openaiCodex: {
      enabled: boolean
      connected: boolean
      accessCurrent: boolean
    }
  }
}

/**
 * Build the public, secret-free execution posture shared by health, doctor, and Config.
 * Runtime probes stay outside this pure projection so tests never need Docker or OAuth credentials.
 */
export function projectExecutionSecurity(
  input: ExecutionSecurityProjectionInput,
): ExecutionSecurityReport {
  const providerBaselineEligible =
    input.protectedUnattendedTurns.openaiCodex.enabled &&
    input.protectedUnattendedTurns.openaiCodex.connected
  const baseRuntimeReady =
    input.protectedUnattendedTurns.docker.ready &&
    input.protectedUnattendedTurns.docker.configurationValid !== false &&
    providerBaselineEligible

  return {
    configuredOperatorHttp: {
      protected: false,
      codingSurface: configuredCodingSurface(input.configuredOperatorHttp.shellSecurity),
      dockerImage: input.configuredOperatorHttp.dockerImage,
      browser: input.configuredOperatorHttp.browserEnabled ? 'enabled' : 'disabled',
      mcp: input.configuredOperatorHttp.mcpEnabled ? 'enabled' : 'disabled',
    },
    protectedUnattendedTurns: {
      baseRuntimeReady,
      codingSurface: 'docker',
      docker: {
        ready: input.protectedUnattendedTurns.docker.ready,
        image: input.protectedUnattendedTurns.docker.image,
        reason: input.protectedUnattendedTurns.docker.ready
          ? null
          : input.protectedUnattendedTurns.docker.reason,
      },
      browser: 'denied',
      mcp: 'denied',
      openaiCodex: {
        ...input.protectedUnattendedTurns.openaiCodex,
        refreshOnNextTurn:
          input.protectedUnattendedTurns.openaiCodex.connected &&
          !input.protectedUnattendedTurns.openaiCodex.accessCurrent,
        baselineEligible: providerBaselineEligible,
      },
      remediation: baseRuntimeReady ? null : remediationFor(input),
    },
  }
}

function configuredCodingSurface(
  shellSecurity: HealthReport['shellSecurity'],
): ExecutionSecurityReport['configuredOperatorHttp']['codingSurface'] {
  if (!shellSecurity.ok) return 'unavailable'
  return shellSecurity.sandboxMode === 'docker' ? 'docker' : 'host'
}

function remediationFor(input: ExecutionSecurityProjectionInput): string {
  const { enabled, connected } = input.protectedUnattendedTurns.openaiCodex
  if (!enabled && !connected) {
    return 'Enable OpenAI Codex and connect ChatGPT on the Config page.'
  }
  if (!enabled) return 'Enable OpenAI Codex on the Config page.'
  if (!connected) return 'Connect ChatGPT for OpenAI Codex on the Config page.'
  if (input.protectedUnattendedTurns.docker.configurationValid === false) {
    return 'Fix the shell-security configuration in Config Services, then retry.'
  }
  const reason = input.protectedUnattendedTurns.docker.reason
  return reason ? DOCKER_REMEDIATIONS[reason] : DOCKER_REMEDIATIONS['Docker preflight failed']
}

const DOCKER_REMEDIATIONS: Record<ProtectedDockerReadinessReason, string> = {
  'unsupported platform':
    'Run protected unattended work on a POSIX host with local Docker support.',
  'Docker executable is unavailable':
    'Install Docker locally and ensure the Bazilion daemon can execute it.',
  'Docker must use a local Unix socket':
    'Switch Docker to a local Unix-socket context, then retry.',
  'Docker socket is unavailable':
    'Start the local Docker daemon and allow Bazilion to access its Unix socket.',
  'Docker image is unavailable':
    'Make the configured protected Docker image available locally without pulling.',
  'Docker image declares writable volumes':
    'Use a protected Docker image that declares no writable VOLUME paths.',
  'Docker preflight failed': 'Check the local Docker daemon and protected image, then retry.',
}
