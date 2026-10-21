import { writeSync } from 'node:fs'

// Keep this dependency-free guard before application imports. The daemon owns
// its own copy: CLI runtime code must not import daemon internals. Contract tests
// bind both copies and the manifests to the same supported stable release lines.
export const SUPPORTED_NODE_RANGE = '^24.22.0 || ^26.4.0'

export function isSupportedNodeVersion(version: string): boolean {
  if (version !== version.trim()) return false
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version)
  if (!match) return false
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  if (![major, minor, patch].every(Number.isSafeInteger)) return false
  return (major === 24 && minor >= 22) || (major === 26 && minor >= 4)
}

if (!isSupportedNodeVersion(process.versions.node)) {
  writeSync(
    process.stderr.fd,
    `bazilion requires Node.js ${SUPPORTED_NODE_RANGE}; received ${process.versions.node}. Upgrade Node.js before starting Bazilion; no home was opened.\n`,
  )
  process.exit(1)
}
