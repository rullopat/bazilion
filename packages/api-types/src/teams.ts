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

/**
 * Body for `PUT /api/teams/order` (the Teams) and `PUT /api/teams/:id/agents/order` (one Team's
 * Agents): those named come first, in this order, and the rest follow in the order they had.
 * Agents may be named by id, unambiguous id prefix, or name in the Team.
 */
export interface SetOrderRequest {
  ids: string[]
}
