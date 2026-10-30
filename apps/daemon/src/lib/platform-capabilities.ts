import type { PlatformCapabilitiesReport } from '@bazilion/api-types'

/** Presentation only. Admission remains in each execution path; this runs no probes. */
export function projectPlatformCapabilities(
  platform: string = process.platform,
): PlatformCapabilitiesReport {
  const linux = platform === 'linux'
  const portable = linux || platform === 'darwin'
  const unsupported = 'Bazilion Agent turns are unsupported on this operating system.'
  return {
    platform: linux ? 'Linux' : platform === 'darwin' ? 'macOS' : 'Unsupported platform',
    note: 'Platform support only, not an execution or connectivity test. Every turn still validates its provider, configuration, repository context and resource ownership.',
    capabilities: [
      {
        id: 'ordinary_chat',
        label: 'Ordinary interactive chat',
        support: portable ? 'supported' : 'unsupported',
        detail:
          platform === 'darwin'
            ? 'Trusted host execution is unisolated. Select and test a provider, then try interactive chat; no chat was run by this report. Protected execution is unavailable without qualified isolation.'
            : portable
              ? 'Select and test a provider, then try an Agent chat. No chat was run by this report.'
              : unsupported,
      },
      {
        id: 'git_inspection',
        label: 'Hardened Git inspection',
        support: portable ? 'supported' : 'unsupported',
        detail: linux
          ? 'Repository layout and source checks still apply at capture time.'
          : portable
            ? 'Uses a bounded private worktree capture. Unsafe layouts, source changes and capture limits still refuse inspection.'
            : unsupported,
      },
      {
        id: 'mcp_stdio',
        label: 'MCP stdio',
        support: portable ? 'supported' : 'unsupported',
        detail: linux
          ? 'Enable and test a configured server separately; process ownership checks still apply.'
          : portable
            ? 'Requires native process ownership inspection. Unknown identity or cleanup blocks the connection. Use Streamable HTTP if native inspection is unavailable.'
            : unsupported,
      },
      {
        id: 'mcp_http',
        label: 'MCP Streamable HTTP',
        support: portable ? 'supported' : 'unsupported',
        detail: portable
          ? 'Portable transport. Enable and test a configured server separately; protected turns still deny MCP.'
          : unsupported,
      },
    ],
  }
}
