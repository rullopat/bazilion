/** Optional per-Team defaults for Docker sandbox commands (`PUT /api/teams/:id/coding-environment`). */
export interface TeamCodingEnvironment {
  /** Local Docker image for this Team's sandbox commands; null uses the installation image. */
  image: string | null
  /** Working directory of sandbox commands, relative to the Team workspace ('.' is its root). */
  cwd: string
}

/** `GET /api/teams/:id/coding-environment`: the Team's defaults and what they apply to. */
export interface CodingEnvironmentStatus extends TeamCodingEnvironment {
  /** BAZILION_BASH_SANDBOX; the defaults are used only in docker mode. */
  sandboxMode: 'off' | 'docker'
  /** The installation image (BAZILION_BASH_SANDBOX_IMAGE), used when `image` is null. */
  defaultImage: string
}
