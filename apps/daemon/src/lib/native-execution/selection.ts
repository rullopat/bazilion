import { mergeSecretsIntoEnv } from '../../core/secrets.ts'
import {
  MAC_NATIVE_EXECUTION_UNAVAILABLE,
  MAC_PROTECTED_EXECUTION_UNAVAILABLE,
} from '../../runtime/shell/platform-support.ts'
import { resolveShellSecurityConfig } from '../../runtime/shell/security.ts'
import type { DaemonCtx } from '../ctx.ts'
import { ProtectedExecutionUnavailableError } from '../protected-execution-error.ts'

/** Protected work never becomes trusted host execution when qualified isolation is absent. */
export function resolveProtectedExecutionBackend(
  env: Readonly<NodeJS.ProcessEnv>,
  platform: string = process.platform,
): 'native' | 'docker' {
  if (platform === 'darwin')
    throw new ProtectedExecutionUnavailableError(MAC_PROTECTED_EXECUTION_UNAVAILABLE)
  const mode = resolveShellSecurityConfig(env).sandboxMode
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
  if (process.platform === 'darwin')
    throw new ProtectedExecutionUnavailableError(MAC_NATIVE_EXECUTION_UNAVAILABLE)
  if (
    resolveShellSecurityConfig(mergeSecretsIntoEnv(ctx.db, ctx.authToken)).sandboxMode !== 'native'
  )
    throw new ProtectedExecutionUnavailableError(
      'Native execution selection changed; prepare a new turn.',
    )
}
