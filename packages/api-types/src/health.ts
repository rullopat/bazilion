/** `GET /api/health`: unauthenticated liveness. */
export interface PublicHealthResponse {
  ok: true
}

/** `GET /api/health/details`: what `bazilion doctor` and the web readiness card report. */
export interface HealthReport {
  /** Structural install health; Docker readiness is reported under `shellSecurity.docker`. */
  ok: boolean
  home: string
  paths: {
    home: boolean
    db: boolean
    auth: boolean
    profiles: boolean
    agents: boolean
    skills: boolean
  }
  database:
    | { ok: true; profiles: number; activeAgents: number; totalAgents: number; teams: number }
    | { ok: false; error: string }
    | null
  skills: { installed: number; parseErrors: number }
  providers: {
    /** Names of cloud providers with credentials configured (e.g. ['anthropic', 'groq']). */
    configured: string[]
    lmstudio: { customEndpointConfigured: boolean; keyConfigured: boolean }
    ollama: { customEndpointConfigured: boolean }
  }
  webSearch: { braveConfigured: boolean; searxngConfigured: boolean }
  openclaw: { path: string; exists: boolean }
  triggers: { active: number; disabled: number }
  tokens: { active: number }
  scheduler: { enabled: boolean; tickMs: number }
  /** One rule for every turn origin; unattended turns only auto-deny dangerous commands. */
  shellSecurity:
    | {
        ok: true
        sandboxMode: 'off' | 'docker'
        approvalMode: 'off' | 'dangerous'
        sandboxImage: string | null
        hostCodingTools: boolean
        network: 'host' | 'none'
        /** Whether the sandbox image is available locally; checked only in docker mode. */
        docker: {
          ready: boolean
          image: string
          /** Docker's own error when not ready. */
          reason: string | null
          remediation: string | null
        } | null
      }
    | {
        ok: false
        error: string
      }
}
