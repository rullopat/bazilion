// Wire shapes for the managed browser session (BAZ-069).
//
// Hermetic: no Node, process or browser types. Clients (web, mobile, CLI)
// render status from these shapes only. The daemon owns the launcher, profile
// paths and CDP endpoint; none of that crosses the wire here.
//
// `availability` is a configuration/resolution fact — `configured` means an
// executable and mode were resolved, never that a live site accepted a request.
// `state` is the managed lifecycle state.

export type BrowserAvailability = 'disabled' | 'configured' | 'unavailable'

export type BrowserLifecycleState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'recovery_required'

export type BrowserReasonCode =
  | 'browser_disabled'
  | 'browser_not_found'
  | 'browser_invalid_executable'
  | 'browser_display_unavailable'
  | 'browser_incompatible'
  | 'browser_start_failed'
  | 'browser_start_timeout'
  | 'browser_security_unavailable'
  | 'browser_busy'
  | 'browser_capacity_reached'
  | 'browser_recovery_required'
  | 'browser_observation_expired'

export type BrowserExecutableSource = 'configured' | 'installed' | 'bundled'

export type BrowserMode = 'headed' | 'headless'

/** Closed, read-only semantic regions; never arbitrary selectors or actions. */
export const BROWSER_SNAPSHOT_SCOPES = ['dialog', 'main', 'search'] as const
export type BrowserSnapshotScope = (typeof BROWSER_SNAPSHOT_SCOPES)[number]

/** Safe, path-free description of the selected browser. */
export interface BrowserSelection {
  /** Display name only (e.g. "Brave", "Chromium"). No absolute path. */
  name: string
  source: BrowserExecutableSource
  /** Resolved launch mode. */
  mode: BrowserMode
  /** Last observed version, when a bounded probe has cached one. */
  version?: string
}

/**
 * Read-only status for one Agent's managed browser. Reports cached
 * observations and filesystem/config resolution; it never spawns a browser,
 * probes a version or unlocks a profile.
 */
export interface BrowserStatus {
  agentId: string
  /** The browser service is turned on. */
  enabled: boolean
  availability: BrowserAvailability
  state: BrowserLifecycleState
  /** A managed profile slot exists on disk for this Agent. */
  profilePresent: boolean
  selectedBrowser?: BrowserSelection
  /** Closed, non-secret failure classification. Omitted when healthy. */
  reasonCode?: BrowserReasonCode
  /** Bounded operator-facing next action. Omitted when healthy. */
  remedy?: string
}
