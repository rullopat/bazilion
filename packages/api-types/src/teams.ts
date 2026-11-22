export interface RegisterTeamRequest {
  /** Slug (lowercase, digits, hyphens): the row id and the directory `~/.bazilion/teams/<slug>/`. */
  id: string
  /** Human-readable label. Defaults to `id`. */
  name?: string
  /**
   * Symlink target: the Team slot becomes a symlink to this existing directory instead of a new
   * one, so agents work on an existing project tree.
   */
  link?: string
}

/** Body for `PUT /api/teams/:id/user-md`. */
export interface SetTeamUserMdRequest {
  userMd: string
  /**
   * The text the editor started from. When given, the save is refused (409, code
   * `user_md_changed`) if USER.md no longer reads so: an Agent wrote to it meanwhile.
   */
  expected?: string
}
