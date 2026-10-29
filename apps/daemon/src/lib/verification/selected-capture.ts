import { mergeSecretsIntoEnv } from '../../core/secrets.ts'
import { resolveShellSecurityConfig } from '../../runtime/shell/security.ts'
import { codingSecrets } from '../coding-environment/diagnostics.ts'
import type { DaemonCtx } from '../ctx.ts'
import { assertSelectedNativeBackend } from '../native-execution/selection.ts'
import {
  captureNativeOperatorVerificationRequest,
  captureVerificationRequest,
  type VerificationCaptureResult,
} from './capture.ts'
import { nativeCaptureAdmissions } from './capture-admissions.ts'
import {
  snapshotVerificationCaptureIntent,
  type VerificationCaptureIntent,
} from './capture-input.ts'

/** Shared operator HTTP/CLI/web capture selection. Body/JSON never supplies environment facts. */
export async function captureSelectedOperatorVerificationRequest(
  ctx: DaemonCtx,
  input: VerificationCaptureIntent,
  signal?: AbortSignal,
): Promise<VerificationCaptureResult> {
  const intent = snapshotVerificationCaptureIntent(input)
  const env = mergeSecretsIntoEnv(ctx.db, ctx.authToken)
  try {
    if (resolveShellSecurityConfig(env).sandboxMode !== 'native')
      return captureVerificationRequest(ctx.db, ctx.paths, intent, env)
    return await nativeCaptureAdmissions().run(signal, (admissionSignal) =>
      captureNativeOperatorVerificationRequest(
        ctx.db,
        ctx.paths,
        intent,
        admissionSignal,
        () => [ctx.authToken, ...codingSecrets(mergeSecretsIntoEnv(ctx.db, ctx.authToken))],
        () => assertSelectedNativeBackend(ctx),
      ),
    )
  } catch {
    return {
      kind: 'blocked',
      blocker: {
        reason: 'environment_unavailable',
        detail:
          'Selected verification capture admission is unavailable, cancelled or stopping. No fallback was used.',
      },
    }
  }
}
