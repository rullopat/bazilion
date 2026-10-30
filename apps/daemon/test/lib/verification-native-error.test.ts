import { expect, test } from 'vitest'
import { ProtectedExecutionUnavailableError as LeafError } from '../../src/lib/protected-execution-error.ts'
import { ProtectedExecutionUnavailableError as ProviderError } from '../../src/lib/protected-provider.ts'
import { NativeVerificationPreparationError as LeafNativeError } from '../../src/lib/verification/native-error.ts'
import { NativeVerificationPreparationError as ExecutorError } from '../../src/lib/verification/native-executor.ts'

test('provider/worker/native preparation keep one shared error identity without an evaluation-order dependency', () => {
  expect(ProviderError).toBe(LeafError)
  expect(ExecutorError).toBe(LeafNativeError)
  const error = new LeafNativeError('recovery_required', false)
  expect(error).toBeInstanceOf(ProviderError)
  expect(error.code).toBe('protected_execution_unavailable')
  expect(error.cleanupConfirmed).toBe(false)
})
