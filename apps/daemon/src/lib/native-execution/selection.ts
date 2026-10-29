import { mergeSecretsIntoEnv } from '../../core/secrets.ts'
import { resolveShellSecurityConfig } from '../../runtime/shell/security.ts'
import type { DaemonCtx } from '../ctx.ts'
import { ProtectedExecutionUnavailableError } from '../protected-execution-error.ts'

/** macOS has no Docker execution backend; explicit retired selections are never reinterpreted. */
export function resolveProtectedExecutionBackend(
  env: Readonly<NodeJS.ProcessEnv>,
  platform: string = process.platform,
): 'native' | 'docker' {
  const mode = resolveShellSecurityConfig(env).sandboxMode
  if (platform === 'darwin') {
    if (mode === 'docker')
      throw new ProtectedExecutionUnavailableError(
        'Docker execution is not supported on macOS. Select native execution.',
      )
    return 'native'
  }
  return mode === 'native' ? 'native' : 'docker'
}

/** Captured posture comparison only; it cannot admit a toolchain or authorize a process. */
export function assertSelectedVerificationBackend(
  ctx: DaemonCtx,
  sandbox: 'off' | 'docker' | 'native',
): void {
  if (
    resolveShellSecurityConfig(mergeSecretsIntoEnv(ctx.db, ctx.authToken)).sandboxMode !== sandbox
  )
    throw new ProtectedExecutionUnavailableError(
      'Verification execution selection changed; capture a new request.',
    )
}

/** Passive selection revalidation, never kernel readiness, process ownership or launch authority. */
export function assertSelectedNativeBackend(ctx: DaemonCtx): void {
  if (
    resolveShellSecurityConfig(mergeSecretsIntoEnv(ctx.db, ctx.authToken)).sandboxMode !== 'native'
  )
    throw new ProtectedExecutionUnavailableError(
      'Native execution selection changed; prepare a new turn.',
    )
}
