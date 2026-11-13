import type {
  Agent,
  TeamPolicy,
  TeamPolicyEdge,
  TeamPolicyMode,
  TeamTemplateEdge,
  TeamTemplateSlot,
} from './entities.ts'

/** Body for `POST /api/team-templates` (with `id`) and `PUT /api/team-templates/:id`. */
export interface TeamTemplateInput {
  id?: string
  name: string
  userMd?: string | null
  policyMode?: TeamPolicyMode
  slots?: Array<
    Pick<TeamTemplateSlot, 'profileId' | 'agentName'> &
      Partial<Omit<TeamTemplateSlot, 'profileId' | 'agentName'>>
  >
  edges?: TeamTemplateEdge[]
}

/** Body for `POST /api/team-templates/:id/spawn`: a new Team is created when `teamId` is unknown. */
export interface SpawnTeamTemplateRequest {
  teamId: string
  /** USER.md for a newly created Team; defaults to the template's. */
  userMd?: string
}

export interface SpawnTeamTemplateResponse {
  agents: Agent[]
  team: TeamPolicy
}

/** Body for `PATCH /api/teams/:id/policy`; omitted fields keep their value. */
export interface UpdateTeamPolicyRequest {
  mode?: TeamPolicyMode
  edges?: TeamPolicyEdge[]
}

/** Body for `POST /api/teams/:id/policy/save-as-template`. */
export interface SaveTeamAsTemplateRequest {
  id: string
  name: string
}
