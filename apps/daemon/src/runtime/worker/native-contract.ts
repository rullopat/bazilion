import { release } from 'node:os'
import type { NativeExecutionAdmission } from '@bazilion/api-types'
import { codingRelativePath } from '../../core/coding-environment/config.ts'
import { assertNativeExecutionFacts } from '../../core/coding-environment/native-facts.ts'

/** Closed wire metadata only. Successful parsing is NOT live native admission or availability. */
export function assertNativeExecutionAdmission(
  value: unknown,
): asserts value is NativeExecutionAdmission {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'cwd,facts'
  )
    throw new Error('Invalid native worker description')
  const input = value as Record<string, unknown>
  codingRelativePath(input.cwd)
  const facts = input.facts
  try {
    assertNativeExecutionFacts(facts)
  } catch {
    throw new Error('Invalid native worker facts')
  }
  const fact = facts
  const backend =
    process.platform === 'linux'
      ? 'linux-bwrap'
      : process.platform === 'darwin'
        ? 'darwin-seatbelt'
        : null
  if (
    !backend ||
    !['x64', 'arm64'].includes(process.arch) ||
    fact.backend !== backend ||
    fact.architecture !== process.arch ||
    fact.nodeVersion !== process.version ||
    fact.kernelRelease !== release()
  )
    throw new Error('Native worker facts do not match this runtime')
}
