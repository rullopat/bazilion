import type { NativeExecutionFacts } from '@bazilion/api-types'

/** Portable retained metadata only. Validation never proves admission, availability or ownership. */
export function assertNativeExecutionFacts(value: unknown): asserts value is NativeExecutionFacts {
  const invalid = () => new Error('Invalid native runtime facts')
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).sort().join(',') !==
      'architecture,backend,fingerprint,kernelRelease,nodeVersion,policyFingerprint'
  )
    throw invalid()
  const facts = value as Record<string, unknown>
  if (
    typeof facts.backend !== 'string' ||
    !['linux-bwrap', 'darwin-seatbelt'].includes(facts.backend) ||
    typeof facts.architecture !== 'string' ||
    !['x64', 'arm64'].includes(facts.architecture) ||
    (facts.backend === 'darwin-seatbelt' && facts.architecture !== 'arm64') ||
    typeof facts.nodeVersion !== 'string' ||
    !/^v\d+\.\d+\.\d+$/.test(facts.nodeVersion) ||
    facts.nodeVersion.length > 64 ||
    typeof facts.kernelRelease !== 'string' ||
    !/^[A-Za-z0-9._+-]{1,128}$/.test(facts.kernelRelease) ||
    typeof facts.fingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/.test(facts.fingerprint) ||
    typeof facts.policyFingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/.test(facts.policyFingerprint)
  )
    throw invalid()
}
