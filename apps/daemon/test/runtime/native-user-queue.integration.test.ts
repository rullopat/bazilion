import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { nativeIntegrationEnabled as enabled } from '../fixtures/native-platform.ts'
import { runNativeUserQueueFixture } from '../fixtures/native-user-queue.ts'

test.skipIf(!enabled)(
  'authenticated native queue and communication approvals preserve holds, once-only dispatch, readonly attachments and live cancellation',
  async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-user-queue-')))
    expect(await runNativeUserQueueFixture(root)).toMatchObject({
      authenticatedNativeQueue: true,
      approvedProtectedNativeDispatch: true,
      approvedAttachmentReadonly: true,
      communicationGrantDoesNotGrantShellRisk: true,
      duplicateAndDeniedApprovalCannotReplay: true,
      unavailableNativeQueueFailsWithoutFallback: true,
      configuredNativeQueue: true,
      liveQueueCancellationSettled: true,
      staleQueueStopCannotSignal: true,
      resourcesSettled: true,
      providerTransport: 'synthetic-loopback',
      installedClientQualified: false,
      boundTelegramNativeQueue: true,
      approvedTelegramNativeDispatch: true,
      reboundTelegramRefusedBeforeEffects: true,
      telegramTransport: 'synthetic-notices',
      restartRestoreQualified: false,
    })
    rmSync(root, { recursive: true })
  },
  90_000,
)
